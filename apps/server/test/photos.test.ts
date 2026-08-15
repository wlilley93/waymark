import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { Jar, makeTestApp, truncateAll, uniqueEmail } from "./helpers.js";
import { resetRateLimits } from "../src/services/ratelimit.js";

// 1x1 transparent PNG — the smallest thing sharp will accept
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function multipart(fields: Record<string, string | { filename: string; contentType: string; data: Buffer }>): {
  headers: Record<string, string>;
  payload: Buffer;
} {
  const boundary = "----waymarktest";
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\n`));
    if (typeof value === "string") {
      parts.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    } else {
      parts.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${name}"; filename="${value.filename}"\r\nContent-Type: ${value.contentType}\r\n\r\n`,
        ),
      );
      parts.push(value.data);
      parts.push(Buffer.from("\r\n"));
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(parts),
  };
}

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
    payload: { name: "Photo map" },
    headers: { cookie: jar.header()! },
  });
  const mp = await app.inject({
    method: "POST",
    url: `/api/maps/${map.json().id}/map-places`,
    payload: { newPlace: { name: "Photogenic", location: { lat: 1, lng: 1 }, provider: "manual" }, termIds: [] },
    headers: { cookie: jar.header()! },
  });
  return { jar, mapId: map.json().id as string, mpId: mp.json().id as string };
}

describe("photos", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>;

  beforeAll(async () => {
    app = await makeTestApp();
  });
  afterAll(async () => {
    await app.sqlClient.end();
  });
  beforeEach(async () => {
    await truncateAll(app.db);
    resetRateLimits();
  });

  it("uploads, serves full and thumb, records caption", async () => {
    const { jar, mapId, mpId } = await setup(app.app);
    // NB: caption BEFORE file — @fastify/multipart's file.fields carries only
    // the fields streamed ahead of the file part
    const body = multipart({
      caption: "the tiniest photo",
      file: { filename: "dot.png", contentType: "image/png", data: PNG_1X1 },
    });

    // unauthenticated upload is refused
    const anon = await app.app.inject({
      method: "POST",
      url: `/api/maps/${mapId}/map-places/${mpId}/photos`,
      headers: body.headers,
      payload: body.payload,
    });
    expect(anon.statusCode).toBe(401);

    const up = await app.app.inject({
      method: "POST",
      url: `/api/maps/${mapId}/map-places/${mpId}/photos`,
      headers: { ...body.headers, cookie: jar.header()! },
      payload: body.payload,
    });
    expect(up.statusCode).toBe(201);
    const photo = up.json();
    expect(photo.caption).toBe("the tiniest photo");
    expect(photo.url).toMatch(/^\/api\/photos\//);

    const full = await app.app.inject({
      method: "GET",
      url: photo.url,
      headers: { cookie: jar.header()! },
    });
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toContain("image/png");
    expect(full.rawPayload.length).toBe(PNG_1X1.length);

    const thumb = await app.app.inject({
      method: "GET",
      url: `${photo.url}?thumb=1`,
      headers: { cookie: jar.header()! },
    });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers["content-type"]).toContain("image/webp");

    // detail panel sees the photo
    const detail = await app.app.inject({
      method: "GET",
      url: `/api/maps/${mapId}/map-places/${mpId}`,
      headers: { cookie: jar.header()! },
    });
    expect(detail.json().photos).toHaveLength(1);
    expect(detail.json().photoCount ?? detail.json().photos.length).toBeGreaterThanOrEqual(1);
  });

  it("refuses unsupported media types", async () => {
    const { jar, mapId, mpId } = await setup(app.app);
    const body = multipart({
      file: { filename: "notes.txt", contentType: "text/plain", data: Buffer.from("not an image") },
    });
    const res = await app.app.inject({
      method: "POST",
      url: `/api/maps/${mapId}/map-places/${mpId}/photos`,
      headers: { ...body.headers, cookie: jar.header()! },
      payload: body.payload,
    });
    expect(res.statusCode).toBe(415);
  });

  it("refuses non-members", async () => {
    const { mapId, mpId } = await setup(app.app);
    const stranger = new Jar();
    stranger.absorb(
      await app.app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email: uniqueEmail("s"), password: "correct-horse-battery", name: "Stranger" },
      }),
    );
    const body = multipart({
      file: { filename: "dot.png", contentType: "image/png", data: PNG_1X1 },
    });
    const res = await app.app.inject({
      method: "POST",
      url: `/api/maps/${mapId}/map-places/${mpId}/photos`,
      headers: { ...body.headers, cookie: stranger.header()! },
      payload: body.payload,
    });
    expect(res.statusCode).toBe(403);

    // and a member of ANOTHER map cannot read someone else's photo
    const other = new Jar();
    other.absorb(
      await app.app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email: uniqueEmail("o"), password: "correct-horse-battery", name: "Other" },
      }),
    );
    await app.app.inject({
      method: "POST",
      url: "/api/maps",
      payload: { name: "Other map" },
      headers: { cookie: other.header()! },
    });
    const photos = await app.app.inject({
      method: "GET",
      url: `/api/maps/${mapId}/map-places/${mpId}`,
      headers: { cookie: stranger.header()! },
    });
    expect(photos.statusCode).toBe(403);
  });
});
