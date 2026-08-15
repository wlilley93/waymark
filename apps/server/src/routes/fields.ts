import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { fieldDefWithValidation } from "@waymark/shared";
import type { Db } from "../db/client.js";
import { fieldDefinitions } from "../db/schema.js";
import { requireAuth } from "../plugins/session.js";
import { canWrite, requireMembership } from "../services/places.js";

export function buildFieldRoutes(db: Db) {
  return async function fieldRoutes(app: FastifyInstance) {
    app.get("/api/maps/:mapId/fields", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId } = req.params as { mapId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      const rows = await db.select().from(fieldDefinitions).where(eq(fieldDefinitions.mapId, mapId));
      return rows;
    });

    app.post("/api/maps/:mapId/fields", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId } = req.params as { mapId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member || !canWrite(member.role)) return reply.status(403).send({ error: "forbidden" });
      const input = fieldDefWithValidation.parse(req.body);
      const [existing] = await db
        .select()
        .from(fieldDefinitions)
        .where(and(eq(fieldDefinitions.mapId, mapId), eq(fieldDefinitions.key, input.key)));
      if (existing) return reply.status(409).send({ error: "key_taken" });
      const [row] = await db
        .insert(fieldDefinitions)
        .values({
          mapId,
          key: input.key,
          label: input.label,
          dataType: input.dataType,
          options: input.options ?? null,
          applicableTermIds: input.applicableTermIds ?? null,
          validation: input.validation ?? null,
          required: input.required,
          filterable: input.filterable,
        })
        .returning();
      return reply.status(201).send(row);
    });

    app.delete("/api/maps/:mapId/fields/:fieldId", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId, fieldId } = req.params as { mapId: string; fieldId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member || !canWrite(member.role)) return reply.status(403).send({ error: "forbidden" });
      await db
        .delete(fieldDefinitions)
        .where(and(eq(fieldDefinitions.id, fieldId), eq(fieldDefinitions.mapId, mapId)));
      return reply.send({ ok: true });
    });
  };
}
