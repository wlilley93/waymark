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
  const catFacet = (detail.json().facets as { id: string; key: string }[]).find((f) => f.key === "category")!;
  const vibeFacet = (detail.json().facets as { id: string; key: string }[]).find((f) => f.key === "vibe")!;
  const terms = detail.json().terms as { id: string; facetId: string; name: string }[];
  return {
    jar,
    mapId,
    restaurant: terms.find((t) => t.name === "Restaurant" && t.facetId === catFacet.id)!,
    bar: terms.find((t) => t.name === "Bar" && t.facetId === catFacet.id)!,
    cosy: terms.find((t) => t.name === "Cosy" && t.facetId === vibeFacet.id)!,
  };
}

function placePayload(name: string, lat: number, lng: number, extra: Record<string, unknown> = {}) {
  return {
    newPlace: { name, location: { lat, lng }, provider: "manual" },
    termIds: [],
    ...extra,
  };
}

describe("places: three-layer model + taxonomy + fields", () => {
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

  it("reuses a canonical place via OSM natural key across bookmarks", async () => {
    const osm = { type: "node" as const, id: 12345 };
    const r1 = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/map-places`,
      payload: placePayload("The Reliance", 53.8, -1.54, { primaryTermId: ctx.restaurant.id, termIds: [ctx.restaurant.id] }),
      headers: { cookie: ctx.jar.header()! },
    });
    expect(r1.statusCode).toBe(201);

    // same venue bookmarked via geocode result carrying the same osm id
    const place = await app.app.inject({
      method: "POST",
      url: "/api/places",
      payload: {
        name: "The Reliance",
        location: { lat: 53.8001, lng: -1.5401 },
        provider: "nominatim",
        osm,
      },
      headers: { cookie: ctx.jar.header()! },
    });
    expect(place.statusCode).toBe(201);

    const secondMap = await app.app.inject({
      method: "POST",
      url: "/api/maps",
      payload: { name: "Second map" },
      headers: { cookie: ctx.jar.header()! },
    });
    const mp2 = await app.app.inject({
      method: "POST",
      url: `/api/maps/${secondMap.json().id}/map-places`,
      payload: { placeId: place.json().id, termIds: [] },
      headers: { cookie: ctx.jar.header()! },
    });
    expect(mp2.statusCode).toBe(201);
    // two bookmarks, one canonical place
    expect(mp2.json().place.id).toBe(place.json().id);
  });

  it("manual near-dupe (same name within 5m) reuses the place", async () => {
    await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/map-places`,
      payload: placePayload("Café Nero", 53.8, -1.55),
      headers: { cookie: ctx.jar.header()! },
    });
    const p2 = await app.app.inject({
      method: "POST",
      url: "/api/places",
      payload: { name: "café nero", location: { lat: 53.800001, lng: -1.55 }, provider: "manual" },
      headers: { cookie: ctx.jar.header()! },
    });
    const first = await app.app.inject({
      method: "GET",
      url: `/api/maps/${ctx.mapId}/map-places?bbox=-1.56,53.7,-1.54,53.9`,
      headers: { cookie: ctx.jar.header()! },
    });
    expect(first.json()[0].place.id).toBe(p2.json().id);
  });

  it("rejects duplicate live bookmark of the same place on one map", async () => {
    const r1 = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/map-places`,
      payload: placePayload("One", 10, 10),
      headers: { cookie: ctx.jar.header()! },
    });
    expect(r1.statusCode).toBe(201);
    const r2 = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/map-places`,
      payload: { placeId: r1.json().place.id, termIds: [] },
      headers: { cookie: ctx.jar.header()! },
    });
    expect(r2.statusCode).toBe(409);
  });

  it("primary term must be a category-facet term; unknown terms rejected", async () => {
    const badPrimary = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/map-places`,
      payload: placePayload("X", 1, 1, { primaryTermId: ctx.cosy.id }),
      headers: { cookie: ctx.jar.header()! },
    });
    expect(badPrimary.statusCode).toBe(400);

    const unknownTerm = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/map-places`,
      payload: placePayload("X", 1, 1, { termIds: ["00000000-0000-0000-0000-000000000000"] }),
      headers: { cookie: ctx.jar.header()! },
    });
    expect(unknownTerm.statusCode).toBe(400);
  });

  it("typed field definitions validate values", async () => {
    const fd = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/fields`,
      payload: {
        key: "wheelchair",
        label: "Step-free access",
        dataType: "select",
        options: ["yes", "partial", "no"],
        filterable: true,
      },
      headers: { cookie: ctx.jar.header()! },
    });
    expect(fd.statusCode).toBe(201);

    const good = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/map-places`,
      payload: placePayload("Place", 5, 5, { fields: { wheelchair: "yes" } }),
      headers: { cookie: ctx.jar.header()! },
    });
    expect(good.statusCode).toBe(201);
    expect(good.json().yourRating).toBeNull();

    const detail = await app.app.inject({
      method: "GET",
      url: `/api/maps/${ctx.mapId}/map-places/${good.json().id}`,
      headers: { cookie: ctx.jar.header()! },
    });
    expect(detail.json().fieldValues.wheelchair).toBe("yes");

    const bad = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/map-places`,
      payload: placePayload("Place2", 6, 6, { fields: { wheelchair: "maybe" } }),
      headers: { cookie: ctx.jar.header()! },
    });
    expect(bad.statusCode).toBe(400);
    expect(JSON.stringify(bad.json())).toContain("wheelchair");

    // wrong type entirely
    const badType = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/map-places`,
      payload: placePayload("Place3", 7, 7, { fields: { wheelchair: 42 } }),
      headers: { cookie: ctx.jar.header()! },
    });
    expect(badType.statusCode).toBe(400);
  });

  it("custom facets and terms can be added per map", async () => {
    const facet = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/facets`,
      payload: { key: "season", name: "Season" },
      headers: { cookie: ctx.jar.header()! },
    });
    expect(facet.statusCode).toBe(201);
    const term = await app.app.inject({
      method: "POST",
      url: `/api/maps/${ctx.mapId}/terms`,
      payload: { facetId: facet.json().id, name: "Summer only" },
      headers: { cookie: ctx.jar.header()! },
    });
    expect(term.statusCode).toBe(201);
    expect(term.json().color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
