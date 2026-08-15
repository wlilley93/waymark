import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  createInviteInput,
  createMapInput,
  FACET_SEEDS,
  inviteRecord,
  mapSummary,
} from "@waymark/shared";
import type { Db } from "../db/client.js";
import {
  facets,
  invites,
  maps,
  memberships,
  mapPlaces,
  terms,
  users,
  authAudit,
} from "../db/schema.js";
import { requireAuth } from "../plugins/session.js";
import { hashToken, newToken } from "../util.js";
import { requireMembership, canWrite } from "../services/places.js";

export function buildMapRoutes(db: Db, appOrigin: string) {
  async function seedTaxonomy(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], mapId: string) {
    for (const facet of FACET_SEEDS) {
      const [f] = await tx
        .insert(facets)
        .values({ mapId, key: facet.key, name: facet.name, description: facet.description })
        .returning();
      if (!f) continue;
      await tx.insert(terms).values(
        facet.terms.map((t) => ({ facetId: f.id, name: t.name, color: t.color, icon: t.icon })),
      );
    }
  }

  return async function mapRoutes(app: FastifyInstance) {
    app.get("/api/maps", async (req) => {
      const userId = requireAuth(req);
      const rows = await db
        .select({
          map: maps,
          role: memberships.role,
          memberCount: sql<number>`(SELECT count(*)::int FROM memberships m2 WHERE m2.map_id = ${maps.id})`,
          placeCount: sql<number>`(SELECT count(*)::int FROM map_places mp WHERE mp.map_id = ${maps.id} AND mp.deleted_at IS NULL)`,
        })
        .from(memberships)
        .innerJoin(maps, and(eq(maps.id, memberships.mapId), isNull(maps.deletedAt)))
        .where(eq(memberships.userId, userId));
      return rows.map((r) =>
        mapSummary.parse({
          id: r.map.id,
          name: r.map.name,
          description: r.map.description,
          defaultCamera: r.map.defaultCamera,
          createdAt: r.map.createdAt,
          createdBy: r.map.createdBy,
          yourRole: r.role,
          memberCount: Number(r.memberCount),
          placeCount: Number(r.placeCount),
        }),
      );
    });

    app.post("/api/maps", async (req, reply) => {
      const userId = requireAuth(req);
      const input = createMapInput.parse(req.body);
      const map = await db.transaction(async (tx) => {
        const [m] = await tx
          .insert(maps)
          .values({
            name: input.name,
            description: input.description ?? null,
            defaultCamera: input.defaultCamera ?? null,
            createdBy: userId,
          })
          .returning();
        const created = m!;
        await tx.insert(memberships).values({ mapId: created.id, userId, role: "owner" });
        await seedTaxonomy(tx, created.id);
        return created;
      });
      await db.insert(authAudit).values({ userId, action: "map_created", detail: { mapId: map.id } });
      return reply.status(201).send(
        mapSummary.parse({
          id: map.id,
          name: map.name,
          description: map.description,
          defaultCamera: map.defaultCamera,
          createdAt: map.createdAt,
          createdBy: map.createdBy,
          yourRole: "owner",
          memberCount: 1,
          placeCount: 0,
        }),
      );
    });

    app.get("/api/maps/:mapId", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId } = req.params as { mapId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      const [row] = await db
        .select({
          map: maps,
          memberCount: sql<number>`(SELECT count(*)::int FROM memberships m2 WHERE m2.map_id = ${maps.id})`,
          placeCount: sql<number>`(SELECT count(*)::int FROM map_places mp WHERE mp.map_id = ${maps.id} AND mp.deleted_at IS NULL)`,
        })
        .from(maps)
        .where(and(eq(maps.id, mapId), isNull(maps.deletedAt)));
      if (!row) return reply.status(404).send({ error: "not_found" });
      const facetRows = await db.select().from(facets).where(eq(facets.mapId, mapId));
      const termRows = await db.select({ t: terms }).from(terms).innerJoin(facets, eq(facets.id, terms.facetId)).where(eq(facets.mapId, mapId));
      return reply.send({
        map: mapSummary.parse({
          id: row.map.id,
          name: row.map.name,
          description: row.map.description,
          defaultCamera: row.map.defaultCamera,
          createdAt: row.map.createdAt,
          createdBy: row.map.createdBy,
          yourRole: member.role,
          memberCount: Number(row.memberCount),
          placeCount: Number(row.placeCount),
        }),
        facets: facetRows.map((f) => ({
          id: f.id,
          mapId: f.mapId,
          key: f.key,
          name: f.name,
          description: f.description,
        })),
        terms: termRows.map((r) => ({
          id: r.t.id,
          facetId: r.t.facetId,
          name: r.t.name,
          color: r.t.color,
          icon: r.t.icon,
        })),
      });
    });

    app.patch("/api/maps/:mapId", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId } = req.params as { mapId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member || !canWrite(member.role)) return reply.status(403).send({ error: "forbidden" });
      const body = (req.body ?? {}) as { name?: string; description?: string };
      const [updated] = await db
        .update(maps)
        .set({
          ...(body.name ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(maps.id, mapId))
        .returning();
      return reply.send({ ok: true, name: updated?.name });
    });

    app.delete("/api/maps/:mapId", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId } = req.params as { mapId: string };
      const member = await requireMembership(db, mapId, userId);
      if (member?.role !== "owner") return reply.status(403).send({ error: "forbidden" });
      await db.update(maps).set({ deletedAt: new Date().toISOString() }).where(eq(maps.id, mapId));
      await db.insert(authAudit).values({ userId, action: "map_deleted", detail: { mapId } });
      return reply.send({ ok: true });
    });

    // --- members -----------------------------------------------------------

    app.get("/api/maps/:mapId/members", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId } = req.params as { mapId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      const rows = await db
        .select({ m: memberships, name: users.name, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.mapId, mapId));
      return rows.map((r) => ({
        userId: r.m.userId,
        name: r.name,
        email: r.email,
        role: r.m.role,
        joinedAt: r.m.createdAt,
      }));
    });

    app.delete("/api/maps/:mapId/members/:userId", async (req, reply) => {
      const requester = requireAuth(req);
      const { mapId, userId } = req.params as { mapId: string; userId: string };
      const member = await requireMembership(db, mapId, requester);
      if (member?.role !== "owner") return reply.status(403).send({ error: "forbidden" });
      if (requester === userId) return reply.status(400).send({ error: "cannot_remove_self" });
      await db
        .delete(memberships)
        .where(and(eq(memberships.mapId, mapId), eq(memberships.userId, userId)));
      await db.insert(authAudit).values({ userId: requester, action: "member_removed", detail: { mapId, userId } });
      return reply.send({ ok: true });
    });

    app.patch("/api/maps/:mapId/members/:userId", async (req, reply) => {
      const requester = requireAuth(req);
      const { mapId, userId } = req.params as { mapId: string; userId: string };
      const body = (req.body ?? {}) as { role?: string };
      const member = await requireMembership(db, mapId, requester);
      if (member?.role !== "owner") return reply.status(403).send({ error: "forbidden" });
      if (body.role !== "editor" && body.role !== "viewer") {
        return reply.status(400).send({ error: "bad_role" });
      }
      await db
        .update(memberships)
        .set({ role: body.role })
        .where(and(eq(memberships.mapId, mapId), eq(memberships.userId, userId)));
      return reply.send({ ok: true });
    });

    // --- invites -------------------------------------------------------------

    app.post("/api/maps/:mapId/invites", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId } = req.params as { mapId: string };
      const input = createInviteInput.parse(req.body);
      const member = await requireMembership(db, mapId, userId);
      if (member?.role !== "owner") return reply.status(403).send({ error: "forbidden" });
      const token = newToken();
      const expiresAt = new Date(Date.now() + input.ttlHours * 3600 * 1000);
      const [invite] = await db
        .insert(invites)
        .values({
          mapId,
          tokenHash: hashToken(token),
          role: input.role,
          maxUses: input.maxUses ?? null,
          expiresAt: expiresAt.toISOString(),
          createdBy: userId,
        })
        .returning();
      await db.insert(authAudit).values({ userId, action: "invite_created", detail: { mapId, inviteId: invite?.id } });
      return reply.status(201).send(
        inviteRecord.parse({
          id: invite!.id,
          mapId,
          role: invite!.role,
          maxUses: invite!.maxUses,
          uses: invite!.uses,
          expiresAt: invite!.expiresAt,
          revokedAt: null,
          createdAt: invite!.createdAt,
          url: `${appOrigin}/#/join/${token}`,
        }),
      );
    });

    app.get("/api/maps/:mapId/invites", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId } = req.params as { mapId: string };
      const member = await requireMembership(db, mapId, userId);
      if (member?.role !== "owner") return reply.status(403).send({ error: "forbidden" });
      const rows = await db.select().from(invites).where(eq(invites.mapId, mapId));
      return rows.map((r) => ({
        id: r.id,
        mapId: r.mapId,
        role: r.role,
        maxUses: r.maxUses,
        uses: r.uses,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt,
        createdAt: r.createdAt,
      }));
    });

    app.delete("/api/maps/:mapId/invites/:inviteId", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId, inviteId } = req.params as { mapId: string; inviteId: string };
      const member = await requireMembership(db, mapId, userId);
      if (member?.role !== "owner") return reply.status(403).send({ error: "forbidden" });
      await db
        .update(invites)
        .set({ revokedAt: new Date().toISOString() })
        .where(and(eq(invites.id, inviteId), eq(invites.mapId, mapId)));
      return reply.send({ ok: true });
    });

    app.post("/api/invites/:token/accept", async (req, reply) => {
      const userId = requireAuth(req);
      const { token } = req.params as { token: string };
      const [invite] = await db
        .select()
        .from(invites)
        .where(and(eq(invites.tokenHash, hashToken(token)), isNull(invites.revokedAt)));
      if (
        !invite ||
        new Date(invite.expiresAt) < new Date() ||
        (invite.maxUses !== null && invite.uses >= invite.maxUses)
      ) {
        return reply.status(400).send({ error: "invalid_invite" });
      }
      const result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(invites)
          .set({ uses: invite.uses + 1 })
          .where(eq(invites.id, invite.id))
          .returning();
        if (!updated) return null;
        await tx
          .insert(memberships)
          .values({ mapId: invite.mapId, userId, role: invite.role })
          .onConflictDoNothing();
        const [m] = await tx
          .select({ name: maps.name })
          .from(maps)
          .where(and(eq(maps.id, invite.mapId), isNull(maps.deletedAt)));
        return m ?? null;
      });
      if (!result) return reply.status(400).send({ error: "invalid_invite" });
      await db.insert(authAudit).values({ userId, action: "invite_accepted", detail: { mapId: invite.mapId } });
      return reply.send({ ok: true, mapId: invite.mapId, mapName: result.name });
    });

    // unused import guard (mapPlaces referenced in placeCount via raw sql above)
    void mapPlaces;
  };
}
