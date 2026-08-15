import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Jar, makeTestApp, truncateAll, uniqueEmail } from "./helpers.js";
import { resetRateLimits } from "../src/services/ratelimit.js";

describe("auth", () => {
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

  it("signup → me → logout → me unauthorized", async () => {
    const jar = new Jar();
    const email = uniqueEmail();
    const res1 = await app.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct-horse-battery", name: "Alice" },
      cookies: {} as never,
      headers: {},
    });
    // use jar manually
    jar.absorb(res1);
    expect(res1.statusCode).toBe(200);
    expect(res1.json().email).toBe(email);

    const me = await app.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: jar.header()! },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().name).toBe("Alice");

    const out = await app.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: jar.header()! },
    });
    jar.absorb(out);
    expect(out.statusCode).toBe(200);

    const me2 = await app.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: jar.header() ?? "" },
    });
    expect(me2.statusCode).toBe(401);
  });

  it("rejects duplicate email", async () => {
    const email = uniqueEmail();
    const payload = { email, password: "correct-horse-battery", name: "A" };
    const r1 = await app.app.inject({ method: "POST", url: "/api/auth/signup", payload });
    const r2 = await app.app.inject({ method: "POST", url: "/api/auth/signup", payload });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(409);
  });

  it("login rotates sessions and rejects bad credentials", async () => {
    const email = uniqueEmail();
    await app.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct-horse-battery", name: "A" },
    });
    const bad = await app.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "wrong-password-x" },
    });
    expect(bad.statusCode).toBe(401);

    const jar = new Jar();
    const good = await app.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "correct-horse-battery" },
    });
    jar.absorb(good);
    expect(good.statusCode).toBe(200);
    const token1 = jar.header()!;

    // login again → old session cookie must be dead (rotation)
    const second = await app.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "correct-horse-battery" },
    });
    jar.absorb(second);
    const meOld = await app.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: token1 },
    });
    expect(meOld.statusCode).toBe(401);
  });

  it("rate-limits repeated login failures", async () => {
    const email = uniqueEmail();
    await app.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct-horse-battery", name: "A" },
    });
    let last = 0;
    for (let i = 0; i < 6; i++) {
      last = (
        await app.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email, password: "nope-nope-nope" },
        })
      ).statusCode;
    }
    expect(last).toBe(429);
  });

  it("password reset: request (logged) → single-use token → old sessions revoked", async () => {
    const email = uniqueEmail();
    await app.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct-horse-battery", name: "A" },
    });
    const jar = new Jar();
    const login = await app.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "correct-horse-battery" },
    });
    jar.absorb(login);

    // the stub "email" is logged by the server; unit-level check inserts a
    // token directly. The production log path is exercised in e2e.
    const { createHash, randomBytes } = await import("node:crypto");
    const token = randomBytes(24).toString("base64url");
    const { users } = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    const [u] = await app.db.select().from(users).where(eq(users.email, email));
    const { authTokens } = await import("../src/db/schema.js");
    await app.db.insert(authTokens).values({
      kind: "password_reset",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      userId: u!.id,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const reset = await app.app.inject({
      method: "POST",
      url: "/api/auth/reset",
      payload: { token, password: "new-password-12345" },
    });
    expect(reset.statusCode).toBe(200);

    const relogin = await app.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "new-password-12345" },
    });
    expect(relogin.statusCode).toBe(200);

    // token is single-use
    const reset2 = await app.app.inject({
      method: "POST",
      url: "/api/auth/reset",
      payload: { token, password: "another-password-123" },
    });
    expect(reset2.statusCode).toBe(400);

    // old pre-reset session was revoked
    const meOld = await app.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: jar.header()! },
    });
    expect(meOld.statusCode).toBe(401);
  });

  it("blocks cross-origin cookie mutations (CSRF policy)", async () => {
    const email = uniqueEmail();
    const r = await app.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct-horse-battery", name: "A" },
      headers: { origin: "https://evil.example" },
    });
    expect(r.statusCode).toBe(403);
  });
});
