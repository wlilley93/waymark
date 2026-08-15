import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import { ZodError } from "zod";
import { loadConfig } from "./config.js";
import { makeDb } from "./db/client.js";
import { buildSessionHandler } from "./plugins/session.js";
import { makeEventBus } from "./services/events.js";
import { buildAuthRoutes } from "./routes/auth.js";
import { buildMapRoutes } from "./routes/maps.js";
import { buildMapPlaceRoutes } from "./routes/mapPlaces.js";
import { buildPlaceRoutes } from "./routes/places.js";
import { buildTaxonomyRoutes } from "./routes/taxonomy.js";
import { buildFieldRoutes } from "./routes/fields.js";
import { buildWsRoutes } from "./routes/ws.js";
import { buildPhotoRoutes } from "./routes/photos.js";
import { rateLimit } from "./services/ratelimit.js";

export async function buildApp(overrides?: { databaseUrl?: string }) {
  const config = loadConfig();
  const { db, sqlClient } = makeDb(overrides?.databaseUrl ?? config.databaseUrl);
  const events = makeEventBus(db);

  const app: FastifyInstance = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: [...config.appOrigins],
    credentials: true,
  });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024 } });
  await app.register(websocket);
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Waymark API",
        version: "0.1.0",
        description:
          "Shared live map of bookmarked places. Canonical places + map_places, facets/terms, typed custom fields, If-Match optimistic concurrency, persisted per-map event sequences.",
      },
      servers: [{ url: "/" }],
    },
  });

  // Session resolution at ROOT scope so every route sees it (plugin scopes
  // would encapsulate the hook away from sibling route scopes).
  {
    const { onRequest } = await buildSessionHandler(db);
    app.addHook("onRequest", onRequest);
  }

  // Global API rate limit (per-IP) — auth routes add tighter per-identity windows
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    const rl = rateLimit(`api:${req.ip}`, 300, 60 * 1000);
    if (!rl.ok) {
      return reply.status(429).header("retry-after", String(rl.retryAfterSec)).send({ error: "rate_limited" });
    }
  });

  // CSRF: same-origin policy for cookie-bearing mutations
  // ([2026] VJS-CC-WAYMARK 1 D9). Browsers send Origin on cross-site requests;
  // absent Origin (curl, tests, same-origin GET) passes.
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/api/maps/") && req.url.endsWith("/ws")) return; // WS upgrade
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return;
    const origin = req.headers.origin;
    if (!origin) return;
    const host = req.headers.host;
    const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
    const selfOrigin = `${proto}://${host}`;
    if (origin === selfOrigin || config.appOrigins.includes(origin.replace(/\/$/, ""))) return;
    return reply.status(403).send({ error: "cross_origin_blocked" });
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: "validation_failed",
        details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.status(status).send({
      error: status === 500 ? "internal_error" : e.message,
    });
  });

  await app.register(buildAuthRoutes(db), { prefix: "" });
  const primaryOrigin = config.appOrigins[0] ?? "http://localhost:5173";
  await app.register(buildMapRoutes(db, primaryOrigin), { prefix: "" });
  await app.register(buildMapPlaceRoutes(db, events), { prefix: "" });
  await app.register(buildPlaceRoutes(db), { prefix: "" });
  await app.register(buildTaxonomyRoutes(db), { prefix: "" });
  await app.register(buildFieldRoutes(db), { prefix: "" });
  await app.register(buildWsRoutes(db, events), { prefix: "" });
  await app.register(buildPhotoRoutes(db, config.photoDir), { prefix: "" });

  app.get("/api/health", async () => ({ ok: true, name: "waymark", version: "0.1.0" }));
  app.get("/api/openapi.json", async () => app.swagger());

  return { app, db, sqlClient, events };
}
