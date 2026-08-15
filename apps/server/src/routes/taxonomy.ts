import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { createFacetInput, createTermInput } from "@waymark/shared";
import type { Db } from "../db/client.js";
import { facets, terms } from "../db/schema.js";
import { requireAuth } from "../plugins/session.js";
import { canWrite, requireMembership } from "../services/places.js";

const TERM_COLORS = ["#e76f51", "#2a9d8f", "#e9c46a", "#4cc9f0", "#c77dff", "#f4a261", "#06d6a0", "#ef476f"];

export function buildTaxonomyRoutes(db: Db) {
  return async function taxonomyRoutes(app: FastifyInstance) {
    app.get("/api/maps/:mapId/facets", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId } = req.params as { mapId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      const facetRows = await db.select().from(facets).where(eq(facets.mapId, mapId));
      const termRows = await db
        .select({ t: terms })
        .from(terms)
        .innerJoin(facets, eq(facets.id, terms.facetId))
        .where(eq(facets.mapId, mapId));
      return {
        facets: facetRows,
        terms: termRows.map((r) => r.t),
      };
    });

    app.post("/api/maps/:mapId/facets", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId } = req.params as { mapId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member || !canWrite(member.role)) return reply.status(403).send({ error: "forbidden" });
      const input = createFacetInput.parse(req.body);
      const [existing] = await db
        .select()
        .from(facets)
        .where(and(eq(facets.mapId, mapId), eq(facets.key, input.key)));
      if (existing) return reply.status(409).send({ error: "facet_key_taken" });
      const [facet] = await db
        .insert(facets)
        .values({ mapId, key: input.key, name: input.name, description: input.description ?? null })
        .returning();
      return reply.status(201).send(facet);
    });

    app.post("/api/maps/:mapId/terms", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId } = req.params as { mapId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member || !canWrite(member.role)) return reply.status(403).send({ error: "forbidden" });
      const input = createTermInput.parse(req.body);
      const [facet] = await db
        .select()
        .from(facets)
        .where(and(eq(facets.id, input.facetId), eq(facets.mapId, mapId)));
      if (!facet) return reply.status(404).send({ error: "facet_not_on_map" });
      const color = input.color ?? TERM_COLORS[Math.floor(Math.random() * TERM_COLORS.length)]!;
      const [existing] = await db
        .select()
        .from(terms)
        .where(and(eq(terms.facetId, input.facetId), eq(terms.name, input.name)));
      if (existing) return reply.status(409).send({ error: "term_name_taken" });
      const [term] = await db
        .insert(terms)
        .values({ facetId: input.facetId, name: input.name, color, icon: input.icon ?? null })
        .returning();
      return reply.status(201).send(term);
    });

    app.delete("/api/maps/:mapId/terms/:termId", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId, termId } = req.params as { mapId: string; termId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member || !canWrite(member.role)) return reply.status(403).send({ error: "forbidden" });
      const [facet] = await db
        .select({ id: facets.id })
        .from(terms)
        .innerJoin(facets, eq(facets.id, terms.facetId))
        .where(and(eq(terms.id, termId), eq(facets.mapId, mapId)));
      if (!facet) return reply.status(404).send({ error: "not_found" });
      await db.delete(terms).where(eq(terms.id, termId)); // cascades map_place_terms
      return reply.send({ ok: true });
    });
  };
}
