import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { Jar, makeTestApp, truncateAll, uniqueEmail } from "./helpers.js";
import { resetRateLimits } from "../src/services/ratelimit.js";

async function setup(app: FastifyInstance) {
  const jar = new Jar();
  jar.absorb(
    await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: uniqueEmail(), password: "correct-horse-battery", name: "Alice" },
    }),
  );
  const map = await app.inject({
    method: "POST",
    url: "/api/maps",
    payload: { name: "Test map" },
    headers: { cookie: jar.header()! },
  });
  const mapId = map.json().id as string;
  const detail = await app.inject({
    method: "GET",
    url: `/api/maps/${mapId}`,
    headers: { cookie: jar.header()! },
  });
  const facets = detail.json().facets as { id: string; key: string }[];
  const terms = detail.json().terms as { id: string; facetId: string; name: string }[];
  const catFacet = facets.find((f) => f.key === "category")!;
  return {
    jar,
    mapId,
    restaurant: terms.find((t) => t.name === "Restaurant" && t.facetId === catFacet.id)!,
    park: terms.find((t) => t.name === "Park" && t.facetId === catFacet.id)!,
  };
}

async function addPlace(
  app: FastifyInstance,
  jar: Jar,
  mapId: string,
  name: string,
  lat: number,
  lng: number,
  opts: { primaryTermId?: string; termIds?: string[]; rating?: number } = {},
) {
  const res = await app.inject({
    method: "POST",
    url: `/api/maps/${mapId}/map-places`,
    payload: {
      newPlace: { name, location: { lat, lng }, provider: "manual" },
      primaryTermId: opts.primaryTermId,
      termIds: opts.termIds ?? [],
      rating: opts.rating,
    },
    headers: { cookie: jar.header()! },
  });
  expect(res.statusCode, `addPlace ${name}: ${res.body}`).toBe(201);
  return res.json();
}

describe("viewport, nearby, concurrency, social", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>;
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    app = await makeTestApp();
  });
  afterAll(async () => {
    await app.sqlClient.end();
  });
  beforeEach(async () => {
    await truncateAll(app.db);
    resetRateLimits();
    ctx = await setup(app.app);
  });

  it("viewport loads by bbox intersection; antipode bbox excludes", async () => {
    await addPlace(app.app, ctx.jar, ctx.mapId, "Leeds A", 53.8, -1.55);
    await addPlace(app.app, ctx.jar, ctx.mapId, "Leeds B", 53.81, -1.54);
    await addPlace(app.app, ctx.jar, ctx.mapId, "Sydney", -33.87, 151.21);

    const leeds = await app.app.inject({
      method: "GET",
      url: `/api/maps/${ctx.mapId}/map-places?bbox=-1.6,53.7,-1.5,53.9`,
      headers: { cookie: ctx.jar.header()! },
    });
    expect(leeds.statusCode).toBe(200);
    expect(leeds.json()).toHaveLength(2);

    const empty = await app.app.inject({
      method: "GET",
      url: `/api/maps/${ctx.mapId}/map-places?bbox=0,0,1,1`,
      headers: { cookie: ctx.jar.header()! },
    });
    expect(empty.json()).toHaveLength(0);

    const bad = await app.app.inject({
      method: "GET",
      url: `/api/maps/${ctx.mapId}/map-places?bbox=banana`,
      headers: { cookie: ctx.jar.header()! },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("term filter and minRating compose on viewport queries", async () => {
    await addPlace(app.app, ctx.jar, ctx.mapId, "R1", 53.8, -1.55, { primaryTermId: ctx.restaurant.id, termIds: [ctx.restaurant.id], rating: 5 });
    await addPlace(app.app, ctx.jar, ctx.mapId, "P1", 53.8, -1.551, { primaryTermId: ctx.park.id, termIds: [ctx.park.id], rating: 2 });

    const onlyRestaurants = await app.app.inject({
      method: "GET",
      url: `/api/maps/${ctx.mapId}/map-places?bbox=-2,53,-1,54&termIds=${ctx.restaurant.id}`,
      headers: { cookie: ctx.jar.header()! },
    });
    expect(onlyRestaurants.json()).toHaveLength(1);
    expect(onlyRestaurants.json()[0].place.name).toBe("R1");

    const goodOnly = await app.app.inject({
      method: "GET",
      url: `/api/maps/${ctx.mapId}/map-places?bbox=-2,53,-1,54&minRating=4`,
      headers: { cookie: ctx.jar.header()! },
    });
    expect(goodOnly.json()).toHaveLength(1);
    expect(goodOnly.json()[0].place.name).toBe("R1");
  });

  it("nearby uses ST_DWithin and 'more like this' matches category", async () => {
    const r1 = await addPlace(app.app, ctx.jar, ctx.mapId, "Reliance", 53.8008, -1.5491, { primaryTermId: ctx.restaurant.id, termIds: [ctx.restaurant.id] });
    await addPlace(app.app, ctx.jar, ctx.mapId, "Other Restaurant", 53.801, -1.549, { primaryTermId: ctx.restaurant.id, termIds: [ctx.restaurant.id] });
    await addPlace(app.app, ctx.jar, ctx.mapId, "Far Park", 53.9, -1.6, { primaryTermId: ctx.park.id, termIds: [ctx.park.id] });
    await addPlace(app.app, ctx.jar, ctx.mapId, "Near Park", 53.8009, -1.5492, { primaryTermId: ctx.park.id, termIds: [ctx.park.id] });

    // restaurants within 300m of the Reliance
    const near = await app.app.inject({
      method: "GET",
      url: `/api/maps/${ctx.mapId}/map-places/nearby?lat=53.8008&lng=-1.5491&radius=300&termId=${ctx.restaurant.id}`,
      headers: { cookie: ctx.jar.header()! },
    });
    expect(near.statusCode).toBe(200);
    const names = near.json().map((x: { place: { name: string } }) => x.place.name);
    expect(names).toContain("Other Restaurant");
    expect(names).not.toContain("Near Park");
    expect(names).not.toContain("Far Park");

    // "more like this": same category as r1, any distance within radius
    const like = await app.app.inject({
      method: "GET",
      url: `/api/maps/${ctx.mapId}/map-places/nearby?lat=53.8008&lng=-1.5491&radius=30000&likeMapPlaceId=${r1.id}`,
      headers: { cookie: ctx.jar.header()! },
    });
    const likeNames = like.json().map((x: { place: { name: string } }) => x.place.name);
    expect(likeNames).toContain("Other Restaurant");
    expect(likeNames).not.toContain("Near Park");
  });

  it("If-Match conflicts return 409 with current; success bumps version and writes revision", async () => {
    const mp = await addPlace(app.app, ctx.jar, ctx.mapId, "Edit me", 53.8, -1.55, { primaryTermId: ctx.restaurant.id, termIds: [ctx.restaurant.id] });
    expect(mp.version).toBe(1);

    // missing If-Match
    const noHeader = await app.app.inject({
      method: "PATCH",
      url: `/api/maps/${ctx.mapId}/map-places/${mp.id}`,
      payload: { sharedNote: "no if-match" },
      headers: { cookie: ctx.jar.header()! },
    });
    expect(noHeader.statusCode).toBe(428);

    // stale version
    const stale = await app.app.inject({
      method: "PATCH",
      url: `/api/maps/${ctx.mapId}/map-places/${mp.id}`,
      payload: { sharedNote: "stale edit" },
      headers: { cookie: ctx.jar.header()!, "if-match": "1" },
    });
    expect(stale.statusCode).toBe(200); // version is 1, this is current

    const conflicting = await app.app.inject({
      method: "PATCH",
      url: `/api/maps/${ctx.mapId}/map-places/${mp.id}`,
      payload: { sharedNote: "behind the times" },
      headers: { cookie: ctx.jar.header()!, "if-match": "1" }, // still claims 1
    });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().error).toBe("version_conflict");
    expect(conflicting.json().currentVersion).toBe(2);
    expect(conflicting.json().current.sharedNote).toBe("stale edit");

    // retries with the fresh version succeed
    const fresh = await app.app.inject({
      method: "PATCH",
      url: `/api/maps/${ctx.mapId}/map-places/${mp.id}`,
      payload: { sharedNote: "caught up" },
      headers: { cookie: ctx.jar.header()!, "if-match": "2" },
    });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().version).toBe(3);

    // revisions are audited
    const detail = await app.app.inject({
      method: "GET",
      url: `/api/maps/${ctx.mapId}/map-places/${mp.id}`,
      headers: { cookie: ctx.jar.header()! },
    });
    expect(detail.json().revisions.length).toBe(2);
    expect(detail.json().revisions[0].changedFields).toContain("sharedNote");
  });

  it("delete requires If-Match and is soft", async () => {
    const mp = await addPlace(app.app, ctx.jar, ctx.mapId, "Delete me", 53.8, -1.55);
    const noHeader = await app.app.inject({
      method: "DELETE",
      url: `/api/maps/${ctx.mapId}/map-places/${mp.id}`,
      headers: { cookie: ctx.jar.header()! },
    });
    expect(noHeader.statusCode).toBe(428);

    const gone = await app.app.inject({
      method: "DELETE",
      url: `/api/maps/${ctx.mapId}/map-places/${mp.id}`,
      headers: { cookie: ctx.jar.header()!, "if-match": "1" },
    });
    expect(gone.statusCode).toBe(200);

    const list = await app.app.inject({
      method: "GET",
      url: `/api/maps/${ctx.mapId}/map-places?bbox=-2,53,-1,54`,
      headers: { cookie: ctx.jar.header()! },
    });
    expect(list.json()).toHaveLength(0);

    const detail = await app.app.inject({
      method: "GET",
      url: `/api/maps/${ctx.mapId}/map-places/${mp.id}`,
      headers: { cookie: ctx.jar.header()! },
    });
    expect(detail.statusCode).toBe(404);

    // re-bookmarking the same place is allowed after soft delete
    const again = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/map-places`,
      payload: { placeId: mp.place.id, termIds: [] },
      headers: { cookie: ctx.jar.header()! },
    });
    expect(again.statusCode).toBe(201);
  });

  it("ratings, personal notes (private by default), shared notes, comments", async () => {
    const mp = await addPlace(app.app, ctx.jar, ctx.mapId, "Social", 53.8, -1.55, { rating: 4 });

    // second user joins
    const invite = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/invites`,
      payload: { role: "editor" },
      headers: { cookie: ctx.jar.header()! },
    });
    const token = (invite.json().url as string).split("/join/")[1]!;
    const bob = new Jar();
    bob.absorb(await app.app.inject({ method: "POST", url: "/api/auth/signup", payload: { email: uniqueEmail("b"), password: "correct-horse-battery", name: "Bob" } }));
    await app.app.inject({ method: "POST", url: `/api/invites/${token}/accept`, payload: {}, headers: { cookie: bob.header()! } });

    // Bob rates 2 → avg (4+2)/2
    const rate = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/map-places/${mp.id}/rating`,
      payload: { stars: 2 },
      headers: { cookie: bob.header()! },
    });
    expect(rate.statusCode).toBe(200);

    // Bob leaves a PRIVATE note
    await app.app.inject({
      method: "PUT",
      url: `/api/maps/${ctx.mapId}/map-places/${mp.id}/note`,
      payload: { body: "bob's secret", shared: false },
      headers: { cookie: bob.header()! },
    });
    // and a shared one
    await app.app.inject({
      method: "PUT",
      url: `/api/maps/${ctx.mapId}/map-places/${mp.id}/note`,
      payload: { body: "bob says go", shared: true },
      headers: { cookie: bob.header()! },
    });

    const comment = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/map-places/${mp.id}/comments`,
      payload: { body: "great spot" },
      headers: { cookie: bob.header()! },
    });
    expect(comment.statusCode).toBe(201);

    // Alice sees: avg 3, her rating 4, Bob's SHARED note but not his private one
    const detail = await app.app.inject({
      method: "GET",
      url: `/api/maps/${ctx.mapId}/map-places/${mp.id}`,
      headers: { cookie: ctx.jar.header()! },
    });
    const d = detail.json();
    expect(d.ratingAvg).toBe(3);
    expect(d.ratingCount).toBe(2);
    expect(d.yourRating).toBe(4);
    expect(d.yourNote).toBeNull();
    expect(d.sharedNotes).toHaveLength(1);
    expect(d.sharedNotes[0].body).toBe("bob says go");
    expect(JSON.stringify(d)).not.toContain("bob's secret");
    expect(d.comments).toHaveLength(1);
    expect(d.comments[0].userName).toBe("Bob");
  });
});
