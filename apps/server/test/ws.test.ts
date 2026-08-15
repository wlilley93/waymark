import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { Jar, makeTestApp, truncateAll, uniqueEmail } from "./helpers.js";
import { resetRateLimits } from "../src/services/ratelimit.js";

// Realtime contract ([2026] VJS-CC-WAYMARK 1 D5): hello carries latestSeq;
// live events stream with strictly increasing seq; a reconnecting client that
// missed events replays them via resync(sinceSeq); handlers dedupe.

function wsConnect(url: string, cookie: string): Promise<WebSocket & { queue: any[]; waiters: ((v: any) => void)[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { cookie } }) as WebSocket & { queue: any[]; waiters: ((v: any) => void)[] };
    ws.queue = [];
    ws.waiters = [];
    ws.on("message", (raw: Buffer) => {
      const parsed = JSON.parse(raw.toString());
      const waiter = ws.waiters.shift();
      if (waiter) waiter(parsed);
      else ws.queue.push(parsed);
    });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket & { queue: any[]; waiters: ((v: any) => void)[] }, timeoutMs = 5000): Promise<any> {
  const queued = ws.queue.shift();
  if (queued !== undefined) return Promise.resolve(queued);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ws message timeout")), timeoutMs);
    ws.waiters.push((v) => {
      clearTimeout(t);
      resolve(v);
    });
  });
}

describe("websocket realtime + resync", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>;
  let baseUrl = "";

  beforeAll(async () => {
    app = await makeTestApp();
    await app.app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.app.server.address() as { port: number };
    const port = address.port;
    baseUrl = `ws://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await app.app.close();
    await app.sqlClient.end();
  });
  beforeEach(async () => {
    await truncateAll(app.db);
    resetRateLimits();
  });

  async function setupMap() {
    const jar = new Jar();
    jar.absorb(
      await app.app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email: uniqueEmail(), password: "correct-horse-battery", name: "Alice" },
      }),
    );
    const map = await app.app.inject({
      method: "POST",
      url: "/api/maps",
      payload: { name: "Live map" },
      headers: { cookie: jar.header()! },
    });
    return { jar, mapId: map.json().id as string };
  }

  it("hello → live events with seq; resync replays missed events", async () => {
    const { jar, mapId } = await setupMap();

    const ws = await wsConnect(`${baseUrl}/api/maps/${mapId}/ws`, jar.header()!);
    const hello = await nextMessage(ws);
    expect(hello.type).toBe("hello");
    expect(hello.latestSeq).toBe(0);

    // create two bookmarks over HTTP → two live events
    const mp1 = await app.app.inject({
      method: "POST",
      url: `/api/maps/${mapId}/map-places`,
      payload: { newPlace: { name: "One", location: { lat: 1, lng: 1 }, provider: "manual" }, termIds: [] },
      headers: { cookie: jar.header()! },
    });
    expect(mp1.statusCode).toBe(201);
    const ev1 = await nextMessage(ws);
    expect(ev1.type).toBe("place.created");
    expect(ev1.seq).toBe(1);
    expect(ev1.payload.place.name).toBe("One");

    await app.app.inject({
      method: "POST",
      url: `/api/maps/${mapId}/map-places`,
      payload: { newPlace: { name: "Two", location: { lat: 2, lng: 2 }, provider: "manual" }, termIds: [] },
      headers: { cookie: jar.header()! },
    });
    const ev2 = await nextMessage(ws);
    expect(ev2.type).toBe("place.created");
    expect(ev2.seq).toBe(2);

    // a second client connects AFTER both events and missed them
    const ws2 = await wsConnect(`${baseUrl}/api/maps/${mapId}/ws`, jar.header()!);
    const hello2 = await nextMessage(ws2);
    expect(hello2.latestSeq).toBe(2);

    // a third event happens while ws2 hasn't resynced
    await app.app.inject({
      method: "POST",
      url: `/api/maps/${mapId}/map-places`,
      payload: { newPlace: { name: "Three", location: { lat: 3, lng: 3 }, provider: "manual" }, termIds: [] },
      headers: { cookie: jar.header()! },
    });
    const ev3 = await nextMessage(ws); // first client sees it live
    expect(ev3.seq).toBe(3);
    await nextMessage(ws2); // second client ALSO gets it live

    // ws2 now resyncs from 0 → replays 1..3 exactly once each
    ws2.send(JSON.stringify({ type: "resync", sinceSeq: 0 }));
    const r1 = await nextMessage(ws2);
    const r2 = await nextMessage(ws2);
    const r3 = await nextMessage(ws2);
    expect([r1.seq, r2.seq, r3.seq]).toEqual([1, 2, 3]);
    expect(r1.payload.place.name).toBe("One");
    expect(r3.payload.place.name).toBe("Three");

    // live continues after resync without duplicates
    await app.app.inject({
      method: "POST",
      url: `/api/maps/${mapId}/map-places`,
      payload: { newPlace: { name: "Four", location: { lat: 4, lng: 4 }, provider: "manual" }, termIds: [] },
      headers: { cookie: jar.header()! },
    });
    const ev4a = await nextMessage(ws);
    const ev4b = await nextMessage(ws2);
    expect(ev4a.seq).toBe(4);
    expect(ev4b.seq).toBe(4);

    ws.close();
    ws2.close();
  });

  it("unauthenticated sockets are refused", async () => {
    const { mapId } = await setupMap();
    const ws = await wsConnect(`${baseUrl}/api/maps/${mapId}/ws`, "wm_session=bogus");
    const msg = await nextMessage(ws);
    expect(msg.type).toBe("error");
    ws.close();
  });

  it("non-members are refused", async () => {
    const { mapId } = await setupMap();
    const stranger = new Jar();
    stranger.absorb(
      await app.app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email: uniqueEmail(), password: "correct-horse-battery", name: "Eve" },
      }),
    );
    const ws = await wsConnect(`${baseUrl}/api/maps/${mapId}/ws`, stranger.header()!);
    const msg = await nextMessage(ws);
    expect(msg.type).toBe("error");
    expect(msg.code).toBe("not_a_member");
    ws.close();
  });
});
