import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { Jar, makeTestApp, truncateAll, uniqueEmail } from "./helpers.js";
import { resetRateLimits } from "../src/services/ratelimit.js";
import { __setTestGeocoder, type Geocoder } from "../src/services/geocoder.js";

// Geocoder provider interface ([2026] VJS-CC-WAYMARK 1 D7): the route is a
// thin pass-through to the registered provider; the Nominatim adapter is
// policy-compliant (UA header, spacing, cache) — asserted here against a
// stubbed fetch, never the public instance.

describe("geocode", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>;

  beforeAll(async () => {
    app = await makeTestApp();
  });
  afterAll(async () => {
    await app.sqlClient.end();
    __setTestGeocoder(null);
  });
  beforeEach(async () => {
    await truncateAll(app.db);
    resetRateLimits();
    __setTestGeocoder(null);
  });

  async function authed() {
    const jar = new Jar();
    jar.absorb(
      await app.app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email: uniqueEmail(), password: "correct-horse-battery", name: "A" },
      }),
    );
    return jar;
  }

  it("routes through the registered provider", async () => {
    const fake: Geocoder = {
      id: "nominatim",
      async search(q) {
        return [{ name: `stub:${q}`, lat: 1, lng: 2 }];
      },
    };
    __setTestGeocoder(fake);
    const jar = await authed();
    const res = await app.app.inject({
      method: "GET",
      url: "/api/geocode?q=reliance+leeds",
      headers: { cookie: jar.header()! },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().provider).toBe("nominatim");
    expect(res.json().results[0].name).toBe("stub:reliance leeds");
  });

  it("requires a submitted query of sane length; rate-limits hammering", async () => {
    const jar = await authed();
    const bad = await app.app.inject({
      method: "GET",
      url: "/api/geocode?q=",
      headers: { cookie: jar.header()! },
    });
    expect(bad.statusCode).toBe(400);

    __setTestGeocoder({
      id: "nominatim",
      async search(q) {
        return [{ name: q, lat: 0, lng: 0 }];
      },
    });
    let last = 200;
    for (let i = 0; i < 35; i++) {
      last = (
        await app.app.inject({
          method: "GET",
          url: `/api/geocode?q=query-${i}`,
          headers: { cookie: jar.header()! },
        })
      ).statusCode;
    }
    expect(last).toBe(429);
  });

  it("unauthenticated users cannot geocode", async () => {
    const res = await app.app.inject({ method: "GET", url: "/api/geocode?q=leeds" });
    expect(res.statusCode).toBe(401);
  });
});

describe("nominatim adapter policy", () => {
  it("sends a real User-Agent, spaces calls >=1s, and caches repeats", async () => {
    const { makeNominatimAdapter } = await import("../src/services/geocoder.js");
    const calls: { url: string; headers: Record<string, string>; at: number }[] = [];
    const fetchStub = vi.fn(async (url: URL | string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        at: Date.now(),
      });
      return new Response(
        JSON.stringify([
          {
            name: "The Reliance",
            display_name: "The Reliance, 105 North Street, Leeds",
            lat: "53.8008",
            lon: "-1.5491",
            osm_type: "node",
            osm_id: 12345,
          },
        ]),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchStub);

    const adapter = makeNominatimAdapter();
    const r1 = await adapter.search("reliance leeds");
    expect(r1[0]?.name).toBe("The Reliance");
    expect(r1[0]?.osm).toEqual({ type: "node", id: 12345 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers["User-Agent"]).toMatch(/Waymark/);
    expect(calls[0]?.url).toContain("format=jsonv2");

    // repeat within cache TTL → no second network call
    await adapter.search("reliance leeds");
    expect(calls).toHaveLength(1);

    // different query → second call, spaced >=1s from the first
    await adapter.search("other query");
    expect(calls).toHaveLength(2);
    expect((calls[1]?.at ?? 0) - (calls[0]?.at ?? 0)).toBeGreaterThanOrEqual(1000);

    vi.unstubAllGlobals();
  });
});
