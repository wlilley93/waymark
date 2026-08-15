import type { FastifyInstance } from "fastify";
import { getGeocoder, listGeocoders } from "../services/geocoder.js";
import { requireAuth } from "../plugins/session.js";
import { rateLimit } from "../services/ratelimit.js";
import { upsertPlace } from "../services/places.js";
import { createPlaceInput, placeRecord } from "@waymark/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { places, placeSources } from "../db/schema.js";

export function buildPlaceRoutes(db: Db) {
  return async function placeRoutes(app: FastifyInstance) {
    // Submitted-query geocoding through the provider interface
    // ([2026] VJS-CC-WAYMARK 1 D7). NOT autocomplete: one explicit query per
    // call, rate-limited, provider-swappable.
    app.get("/api/geocode", async (req, reply) => {
      requireAuth(req);
      const q = (req.query as { q?: string; provider?: string }).q;
      if (!q || q.trim().length < 2) return reply.status(400).send({ error: "bad_q" });
      const rl = rateLimit(`geocode:${req.userId ?? req.ip}`, 30, 60 * 1000);
      if (!rl.ok) return reply.status(429).send({ error: "rate_limited" });
      try {
        const provider = getGeocoder(q ? (req.query as { provider?: string }).provider : undefined);
        const results = await provider.search(q.trim());
        return { provider: provider.id, results };
      } catch {
        return reply.status(502).send({ error: "geocoder_unavailable" });
      }
    });

    app.get("/api/geocoders", async (req) => {
      requireAuth(req);
      return listGeocoders();
    });

    // Canonical place creation (client picked a geocode result or typed one in)
    app.post("/api/places", async (req, reply) => {
      const userId = requireAuth(req);
      const input = createPlaceInput.parse(req.body);
      const place = await upsertPlace(db, { ...input, createdBy: userId });
      return reply.status(201).send(
        placeRecord.parse({
          id: place.id,
          name: place.name,
          location: place.location,
          address: place.address,
          website: place.website,
          operationalStatus: place.operationalStatus,
          osm: null,
          createdAt: place.createdAt,
          updatedAt: place.updatedAt,
        }),
      );
    });

    app.get("/api/places/:placeId", async (req, reply) => {
      requireAuth(req);
      const { placeId } = req.params as { placeId: string };
      const [place] = await db.select().from(places).where(eq(places.id, placeId));
      if (!place || place.deletedAt) return reply.status(404).send({ error: "not_found" });
      const sources = await db.select().from(placeSources).where(eq(placeSources.placeId, placeId));
      return {
        ...placeRecord.parse({
          id: place.id,
          name: place.name,
          location: place.location,
          address: place.address,
          website: place.website,
          operationalStatus: place.operationalStatus,
          osm: null,
          createdAt: place.createdAt,
          updatedAt: place.updatedAt,
        }),
        sources: sources.map((s) => ({ provider: s.provider, externalId: s.externalId })),
      };
    });
  };
}
