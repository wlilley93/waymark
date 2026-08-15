import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, gt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

export const SESSION_COOKIE = "wm_session";

declare module "fastify" {
  interface FastifyRequest {
    userId: string | null;
    userName: string | null;
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function buildSessionHandler(db: Db) {
  const onRequest = async (req: FastifyRequest) => {
    req.userId = null;
    req.userName = null;
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const [row] = await db
      .select({ userId: users.id, userName: users.name })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.id, hashSessionToken(token)),
          isNull(sessions.revokedAt),
          isNull(users.deletedAt),
          gt(sessions.expiresAt, new Date().toISOString()),
        ),
      );
    if (!row) return;
    req.userId = row.userId;
    req.userName = row.userName;
  };
  return { onRequest };
}

export async function createSession(
  db: Db,
  userId: string,
  ttlHours: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
  await db.insert(sessions).values({
    id: hashSessionToken(token),
    userId,
    expiresAt: expiresAt.toISOString(),
  });
  return { token, expiresAt };
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  secure: boolean,
) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function requireAuth(req: FastifyRequest): string {
  if (!req.userId) {
    throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
  }
  return req.userId;
}
