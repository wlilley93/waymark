import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { hash, verify } from "@node-rs/argon2";
import {
  loginInput,
  resetInput,
  resetRequestInput,
  signupInput,
  userPublic,
} from "@waymark/shared";
import type { Db } from "../db/client.js";
import { authAudit, authTokens, sessions, users } from "../db/schema.js";
import { loadConfig } from "../config.js";
import {
  clearSessionCookie,
  createSession,
  hashSessionToken,
  requireAuth,
  SESSION_COOKIE,
  setSessionCookie,
} from "../plugins/session.js";
import { hashToken, newToken } from "../util.js";
import { rateLimit } from "../services/ratelimit.js";

export function buildAuthRoutes(db: Db) {
  const config = loadConfig();

  async function audit(userId: string | null, action: string, req: { ip?: string }, detail?: unknown) {
    await db.insert(authAudit).values({
      userId,
      action,
      ip: req.ip ?? null,
      detail: (detail ?? null) as object | null,
    });
  }

  function logEmail(to: string, subject: string, body: string) {
    if (config.logEmails) {
      console.log(`[email:stub] to=${to} subject="${subject}"\n${body}`);
    }
  }

  return async function authRoutes(app: FastifyInstance) {
    app.post("/api/auth/signup", async (req, reply) => {
      const input = signupInput.parse(req.body);
      const rl = rateLimit(`signup:${req.ip}`, 5, 15 * 60 * 1000);
      if (!rl.ok) return reply.status(429).send({ error: "rate_limited" });

      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, input.email), isNull(users.deletedAt)));
      if (existing) {
        return reply.status(409).send({ error: "email_taken" });
      }
      const passwordHash = await hash(input.password);
      const [user] = await db
        .insert(users)
        .values({ email: input.email, name: input.name, passwordHash })
        .returning();
      if (!user) throw new Error("signup failed");

      // email verification token (delivery stubbed in the dev posture)
      const verifyToken = newToken();
      await db.insert(authTokens).values({
        kind: "email_verify",
        tokenHash: hashToken(verifyToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      });
      logEmail(
        user.email,
        "Verify your Waymark account",
        `POST /api/auth/verify { "token": "${verifyToken}" }`,
      );

      const session = await createSession(db, user.id, config.sessionTtlHours);
      setSessionCookie(reply, session.token, session.expiresAt, config.secureCookies);
      await audit(user.id, "signup", req);
      return reply.send(userPublic.parse({
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      }));
    });

    app.post("/api/auth/verify", async (req, reply) => {
      const { token } = req.body as { token?: string };
      if (!token) return reply.status(400).send({ error: "bad_request" });
      const [row] = await db
        .select()
        .from(authTokens)
        .where(and(eq(authTokens.tokenHash, hashToken(token)), eq(authTokens.kind, "email_verify"), isNull(authTokens.usedAt)));
      if (!row || new Date(row.expiresAt) < new Date()) {
        return reply.status(400).send({ error: "invalid_token" });
      }
      await db.update(authTokens).set({ usedAt: new Date().toISOString() }).where(eq(authTokens.id, row.id));
      await db.update(users).set({ emailVerifiedAt: new Date().toISOString() }).where(eq(users.id, row.userId));
      await audit(row.userId, "email_verified", req);
      return reply.send({ ok: true });
    });

    app.post("/api/auth/login", async (req, reply) => {
      const input = loginInput.parse(req.body);
      const rl = rateLimit(`login:${input.email}:${req.ip}`, 5, 15 * 60 * 1000);
      if (!rl.ok) {
        await audit(null, "login_rate_limited", req, { email: input.email });
        return reply
          .status(429)
          .header("retry-after", String(rl.retryAfterSec))
          .send({ error: "rate_limited" });
      }
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, input.email), isNull(users.deletedAt)));
      const ok = user ? await verify(user.passwordHash, input.password) : false;
      if (!user || !ok) {
        await audit(user?.id ?? null, "login_failed", req);
        return reply.status(401).send({ error: "invalid_credentials" });
      }

      // session rotation: revoke any prior live sessions for this user
      await db
        .update(sessions)
        .set({ revokedAt: new Date().toISOString() })
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));

      const session = await createSession(db, user.id, config.sessionTtlHours);
      setSessionCookie(reply, session.token, session.expiresAt, config.secureCookies);
      await audit(user.id, "login", req);
      return reply.send(userPublic.parse({
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      }));
    });

    app.post("/api/auth/logout", async (req, reply) => {
      const token = req.cookies[SESSION_COOKIE];
      if (token) {
        await db
          .update(sessions)
          .set({ revokedAt: new Date().toISOString() })
          .where(eq(sessions.id, hashSessionToken(token)));
      }
      clearSessionCookie(reply);
      await audit(req.userId, "logout", req);
      return reply.send({ ok: true });
    });

    app.get("/api/auth/me", async (req, reply) => {
      if (!req.userId) return reply.status(401).send({ error: "unauthorized" });
      const [user] = await db.select().from(users).where(eq(users.id, req.userId));
      if (!user) return reply.status(401).send({ error: "unauthorized" });
      return reply.send(userPublic.parse({
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      }));
    });

    app.post("/api/auth/reset-request", async (req, reply) => {
      const input = resetRequestInput.parse(req.body);
      const rl = rateLimit(`reset:${input.email}`, 3, 15 * 60 * 1000);
      if (!rl.ok) return reply.status(429).send({ error: "rate_limited" });
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, input.email), isNull(users.deletedAt)));
      if (user) {
        const token = newToken();
        await db.insert(authTokens).values({
          kind: "password_reset",
          tokenHash: hashToken(token),
          userId: user.id,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        });
        logEmail(
          user.email,
          "Reset your Waymark password",
          `POST /api/auth/reset { "token": "${token}", "password": "..." } (single use, 1h)`,
        );
      }
      await audit(user?.id ?? null, "reset_requested", req);
      // always ok — no account enumeration
      return reply.send({ ok: true });
    });

    app.post("/api/auth/reset", async (req, reply) => {
      const input = resetInput.parse(req.body);
      const [row] = await db
        .select()
        .from(authTokens)
        .where(
          and(
            eq(authTokens.tokenHash, hashToken(input.token)),
            eq(authTokens.kind, "password_reset"),
            isNull(authTokens.usedAt),
          ),
        );
      if (!row || new Date(row.expiresAt) < new Date()) {
        return reply.status(400).send({ error: "invalid_token" });
      }
      const passwordHash = await hash(input.password);
      await db.transaction(async (tx) => {
        await tx.update(users).set({ passwordHash, updatedAt: new Date().toISOString() }).where(eq(users.id, row.userId));
        await tx.update(authTokens).set({ usedAt: new Date().toISOString() }).where(eq(authTokens.id, row.id));
        // revoke every session — recovery from compromise starts clean
        await tx.update(sessions).set({ revokedAt: new Date().toISOString() }).where(and(eq(sessions.userId, row.userId), isNull(sessions.revokedAt)));
      });
      await audit(row.userId, "password_reset", req);
      return reply.send({ ok: true });
    });

    app.delete("/api/auth/account", async (req, reply) => {
      const userId = requireAuth(req);
      const { password } = (req.body ?? {}) as { password?: string };
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user || !password || !(await verify(user.passwordHash, password))) {
        return reply.status(403).send({ error: "invalid_credentials" });
      }
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            deletedAt: new Date().toISOString(),
            name: "deleted",
            email: `deleted-${user.id}@invalid.local`,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(users.id, userId));
        await tx.update(sessions).set({ revokedAt: new Date().toISOString() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      });
      clearSessionCookie(reply);
      await audit(userId, "account_deleted", req);
      return reply.send({ ok: true });
    });
  };
}
