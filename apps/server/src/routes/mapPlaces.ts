import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql, inArray } from "drizzle-orm";
import {
  createMapPlaceInput,
  createPlaceInput,
  mapPlaceDetail,
  mapPlaceSummary,
  nearbyQuery,
  patchMapPlaceInput,
  parseBBoxParam,
  validateFields,
} from "@waymark/shared";
import type { Db } from "../db/client.js";
import {
  comments,
  facets,
  fieldDefinitions,
  mapPlaceFieldValues,
  mapPlaces,
  mapPlaceTerms,
  notes,
  photos,
  placeRevisions,
  places,
  ratings,
  terms,
  users,
} from "../db/schema.js";
import { requireAuth } from "../plugins/session.js";
import { canWrite, loadDetail, loadOneSummary, requireMembership, toSummary, upsertPlace } from "../services/places.js";
import type { EventPublisher } from "../services/events.js";

export function buildMapPlaceRoutes(db: Db, events: EventPublisher) {
  return async function mapPlaceRoutes(app: FastifyInstance) {
    // helper: fetch summaries with filters; used by viewport + nearby
    async function querySummaries(
      mapId: string,
      viewerId: string | null,
      opts: {
        bboxSql?: ReturnType<typeof sql>;
        termIds?: string[];
        minRating?: number;
        authorId?: string;
        excludeId?: string;
        nearSql?: ReturnType<typeof sql>;
        limit?: number;
      },
    ): Promise<ReturnType<typeof mapPlaceSummary.parse>[]> {
      const conditions = [
        eq(mapPlaces.mapId, mapId),
        isNull(mapPlaces.deletedAt),
      ];
      if (opts.bboxSql) conditions.push(opts.bboxSql);
      if (opts.nearSql) conditions.push(opts.nearSql);
      if (opts.authorId) conditions.push(eq(mapPlaces.addedBy, opts.authorId));
      if (opts.excludeId) conditions.push(sql`${mapPlaces.id} <> ${opts.excludeId}`);
      if (opts.termIds?.length) {
        conditions.push(
          sql`${mapPlaces.id} IN (SELECT mpt.map_place_id FROM map_place_terms mpt WHERE mpt.term_id IN (${sql.join(
            opts.termIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}))`,
        );
      }
      if (opts.minRating) {
        conditions.push(
          sql`(SELECT coalesce(avg(r.stars),0) FROM ratings r WHERE r.map_place_id = ${mapPlaces.id}) >= ${opts.minRating}`,
        );
      }
      const rows = await db
        .select({
          mp: mapPlaces,
          place: places,
          addedByName: users.name,
          ratingAvg: sql<number | null>`(SELECT round(avg(stars)::numeric, 2) FROM ratings WHERE ratings.map_place_id = ${mapPlaces.id})`,
          ratingCount: sql<number>`(SELECT count(*)::int FROM ratings WHERE ratings.map_place_id = ${mapPlaces.id})`,
          yourRating: sql<number | null>`(SELECT stars FROM ratings WHERE ratings.map_place_id = ${mapPlaces.id} AND ratings.user_id = ${viewerId ?? null})`,
          photoCount: sql<number>`(SELECT count(*)::int FROM photos WHERE photos.map_place_id = ${mapPlaces.id})`,
          commentCount: sql<number>`(SELECT count(*)::int FROM comments WHERE comments.map_place_id = ${mapPlaces.id})`,
          termIds: sql<string[]>`(SELECT coalesce(array_agg(t.term_id::text), '{}') FROM map_place_terms t WHERE t.map_place_id = ${mapPlaces.id})`,
          primaryTermId: sql<string | null>`(SELECT t.term_id::text FROM map_place_terms t WHERE t.map_place_id = ${mapPlaces.id} AND t.role = 'primary' LIMIT 1)`,
        })
        .from(mapPlaces)
        .innerJoin(places, eq(places.id, mapPlaces.placeId))
        .innerJoin(users, eq(users.id, mapPlaces.addedBy))
        .where(and(...conditions))
        .limit(opts.limit ?? 500);
      return rows.map((r) => mapPlaceSummary.parse(toSummary(r)));
    }

    // --- viewport: bbox intersection ([2026] VJS-CC-WAYMARK 1 D6) -----------

    app.get("/api/maps/:mapId/map-places", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId } = req.params as { mapId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      const q = req.query as Record<string, string | undefined>;

      let bboxSql: ReturnType<typeof sql> | undefined;
      try {
        const bb = parseBBoxParam(q.bbox ?? "");
        bboxSql = sql`${places.location} && ST_MakeEnvelope(${bb.minLng}, ${bb.minLat}, ${bb.maxLng}, ${bb.maxLat}, 4326)::geography`;
      } catch {
        return reply.status(400).send({ error: "bad_bbox" });
      }
      const termIds = q.termIds ? q.termIds.split(",").filter(Boolean) : undefined;
      const minRating = q.minRating ? Number(q.minRating) : undefined;
      const authorId = q.mine === "true" ? userId : q.authorId;

      return querySummaries(mapId, userId, { bboxSql, termIds, minRating, authorId });
    });

    // --- nearby: ST_DWithin + "more like this" (FR-13) -----------------------

    app.get("/api/maps/:mapId/map-places/nearby", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId } = req.params as { mapId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      const q = nearbyQuery.parse(req.query);

      const nearSql = sql`ST_DWithin(${places.location}, ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography, ${q.radius})`;

      let termIds: string[] | undefined;
      let excludeId: string | undefined;
      if (q.termId) {
        termIds = [q.termId];
      } else if (q.likeMapPlaceId) {
        const [like] = await db
          .select()
          .from(mapPlaces)
          .where(and(eq(mapPlaces.id, q.likeMapPlaceId), eq(mapPlaces.mapId, mapId)));
        if (!like) return reply.status(404).send({ error: "not_found" });
        excludeId = like.id;
        const likeTerms = await db
          .select({ termId: mapPlaceTerms.termId, role: mapPlaceTerms.role })
          .from(mapPlaceTerms)
          .where(eq(mapPlaceTerms.mapPlaceId, like.id));
        const categoryFacet = await db
          .select({ id: facets.id })
          .from(facets)
          .where(and(eq(facets.mapId, mapId), eq(facets.key, "category")));
        const catTerms = likeTerms
          .filter((t) => t.role)
          .map((t) => t.termId);
        if (catTerms.length) {
          // primary/secondary category of the liked place, plus its other terms
          termIds = [...new Set([...catTerms, ...likeTerms.map((t) => t.termId)])];
        } else if (likeTerms.length) {
          termIds = likeTerms.map((t) => t.termId);
        }
        void categoryFacet;
      }

      const results = await querySummaries(mapId, userId, {
        nearSql,
        termIds,
        excludeId,
        limit: 50,
      });
      // nearest first
      results.sort((a, b) => {
        const da = (a.place.location.lat - q.lat) ** 2 + (a.place.location.lng - q.lng) ** 2;
        const dbb = (b.place.location.lat - q.lat) ** 2 + (b.place.location.lng - q.lng) ** 2;
        return da - dbb;
      });
      return results;
    });

    // --- create --------------------------------------------------------------

    app.post("/api/maps/:mapId/map-places", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId } = req.params as { mapId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      if (!canWrite(member.role)) return reply.status(403).send({ error: "forbidden" });
      const input = createMapPlaceInput.parse(req.body);
      if (!input.placeId && !input.newPlace) {
        return reply.status(400).send({ error: "placeId_or_newPlace_required" });
      }

      // validate terms belong to this map; primary must be a category-facet term
      const mapTerms = await db
        .select({ t: terms, facetKey: facets.key })
        .from(terms)
        .innerJoin(facets, eq(facets.id, terms.facetId))
        .where(eq(facets.mapId, mapId));
      const termIdsInMap = new Set(mapTerms.map((r) => r.t.id));
      const allTerms = [...(input.primaryTermId ? [input.primaryTermId] : []), ...input.termIds];
      for (const t of allTerms) {
        if (!termIdsInMap.has(t)) return reply.status(400).send({ error: `unknown_term:${t}` });
      }
      if (input.primaryTermId) {
        const primary = mapTerms.find((r) => r.t.id === input.primaryTermId);
        if (!primary || primary.facetKey !== "category") {
          return reply.status(400).send({ error: "primary_term_must_be_category" });
        }
      }

      // validate typed fields ([2026] VJS-CC-WAYMARK 1 D3)
      const mapFieldDefs = await db.select().from(fieldDefinitions).where(eq(fieldDefinitions.mapId, mapId));
      const fieldCheck = validateFields(
        mapFieldDefs.map((d) => ({
          key: d.key,
          dataType: d.dataType as "text" | "number" | "boolean" | "date" | "url" | "select",
          options: (d.options as string[] | null) ?? undefined,
          validation: (d.validation as never[] | null) ?? undefined,
          required: d.required,
        })),
        input.fields,
      );
      if (!fieldCheck.ok) return reply.status(400).send({ error: "invalid_fields", details: fieldCheck.errors });

      let created: { mpId: string; at: string; seq: number } | null = null;
      try {
        created = await db.transaction(async (tx) => {
          const place = input.placeId
            ? (await tx.select().from(places).where(eq(places.id, input.placeId!)))[0]
            : await upsertPlace(tx, {
                ...(input.newPlace as ReturnType<typeof createPlaceInput.parse>),
                createdBy: userId,
              });
          if (!place || place.deletedAt) throw Object.assign(new Error("place_not_found"), { statusCode: 404 });

          const [dupe] = await tx
            .select()
            .from(mapPlaces)
            .where(and(eq(mapPlaces.mapId, mapId), eq(mapPlaces.placeId, place.id), isNull(mapPlaces.deletedAt)));
          if (dupe) throw Object.assign(new Error("already_bookmarked"), { statusCode: 409 });

          const [mp] = await tx
            .insert(mapPlaces)
            .values({ mapId, placeId: place.id, sharedNote: input.sharedNote ?? null, addedBy: userId })
            .returning();
          const mpRow = mp!;

          const termRows = [
            ...(input.primaryTermId
              ? [{ mapPlaceId: mpRow.id, termId: input.primaryTermId, role: "primary" }]
              : []),
            ...input.termIds
              .filter((t) => t !== input.primaryTermId)
              .map((t) => ({ mapPlaceId: mpRow.id, termId: t, role: null as string | null })),
          ];
          if (termRows.length) await tx.insert(mapPlaceTerms).values(termRows).onConflictDoNothing();

          for (const [key, value] of Object.entries(fieldCheck.values)) {
            const def = mapFieldDefs.find((d) => d.key === key)!;
            await tx
              .insert(mapPlaceFieldValues)
              .values({ mapPlaceId: mpRow.id, fieldDefinitionId: def.id, value: value as object })
              .onConflictDoNothing();
          }

          if (input.rating) {
            await tx.insert(ratings).values({ mapPlaceId: mpRow.id, userId, stars: input.rating });
          }
          if (input.personalNote) {
            await tx
              .insert(notes)
              .values({ mapPlaceId: mpRow.id, userId, body: input.personalNote, shared: false });
          }

          const summary = await loadOneSummaryTx(tx, mapId, mpRow.id, userId);
          const ev = await events.record(tx, mapId, "place.created", summary);
          return { mpId: mpRow.id, at: ev.at, seq: ev.seq };
        });
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        if (e.statusCode === 409 || e.statusCode === 404) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw err;
      }

      const summary = await loadOneSummary(db, mapId, created!.mpId, userId);
      events.publish(mapId, { seq: created!.seq, at: created!.at }, "place.created", summary);
      return reply.status(201).send(summary);
    });

    // loadOneSummary against a tx (same shape as services/places.loadSummaries)
    async function loadOneSummaryTx(
      tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
      mapId: string,
      mpId: string,
      viewerId: string | null,
    ) {
      const [row] = await tx
        .select({
          mp: mapPlaces,
          place: places,
          addedByName: users.name,
          ratingAvg: sql<number | null>`(SELECT round(avg(stars)::numeric, 2) FROM ratings WHERE ratings.map_place_id = ${mapPlaces.id})`,
          ratingCount: sql<number>`(SELECT count(*)::int FROM ratings WHERE ratings.map_place_id = ${mapPlaces.id})`,
          yourRating: sql<number | null>`(SELECT stars FROM ratings WHERE ratings.map_place_id = ${mapPlaces.id} AND ratings.user_id = ${viewerId ?? null})`,
          photoCount: sql<number>`(SELECT count(*)::int FROM photos WHERE photos.map_place_id = ${mapPlaces.id})`,
          commentCount: sql<number>`(SELECT count(*)::int FROM comments WHERE comments.map_place_id = ${mapPlaces.id})`,
          termIds: sql<string[]>`(SELECT coalesce(array_agg(t.term_id::text), '{}') FROM map_place_terms t WHERE t.map_place_id = ${mapPlaces.id})`,
          primaryTermId: sql<string | null>`(SELECT t.term_id::text FROM map_place_terms t WHERE t.map_place_id = ${mapPlaces.id} AND t.role = 'primary' LIMIT 1)`,
        })
        .from(mapPlaces)
        .innerJoin(places, eq(places.id, mapPlaces.placeId))
        .innerJoin(users, eq(users.id, mapPlaces.addedBy))
        .where(and(eq(mapPlaces.mapId, mapId), eq(mapPlaces.id, mpId), isNull(mapPlaces.deletedAt)));
      if (!row) throw new Error("summary vanished");
      return mapPlaceSummary.parse(toSummary(row));
    }

    // --- detail ---------------------------------------------------------------

    app.get("/api/maps/:mapId/map-places/:mpId", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId, mpId } = req.params as { mapId: string; mpId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      const detail = await loadDetail(db, mapId, mpId, userId);
      if (!detail) return reply.status(404).send({ error: "not_found" });
      return mapPlaceDetail.parse(detail);
    });

    // --- patch: If-Match optimistic concurrency ([2026] VJS-CC-WAYMARK 1 D4) --

    app.patch("/api/maps/:mapId/map-places/:mpId", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId, mpId } = req.params as { mapId: string; mpId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      if (!canWrite(member.role)) return reply.status(403).send({ error: "forbidden" });

      const ifMatch = req.headers["if-match"];
      const expected = ifMatch ? Number(ifMatch.replace(/"/g, "")) : null;
      if (expected === null || !Number.isFinite(expected)) {
        return reply.status(428).send({ error: "if_match_required" });
      }
      const input = patchMapPlaceInput.parse(req.body);

      const mapTerms = await db
        .select({ t: terms, facetKey: facets.key })
        .from(terms)
        .innerJoin(facets, eq(facets.id, terms.facetId))
        .where(eq(facets.mapId, mapId));
      const termIdsInMap = new Set(mapTerms.map((r) => r.t.id));
      if (input.primaryTermId) {
        if (!termIdsInMap.has(input.primaryTermId)) {
          return reply.status(400).send({ error: `unknown_term:${input.primaryTermId}` });
        }
        const primary = mapTerms.find((r) => r.t.id === input.primaryTermId);
        if (!primary || primary.facetKey !== "category") {
          return reply.status(400).send({ error: "primary_term_must_be_category" });
        }
      }
      for (const t of input.termIds ?? []) {
        if (!termIdsInMap.has(t)) return reply.status(400).send({ error: `unknown_term:${t}` });
      }
      let newFieldValues: Record<string, unknown> | undefined;
      if (input.fields) {
        const mapFieldDefs = await db.select().from(fieldDefinitions).where(eq(fieldDefinitions.mapId, mapId));
        const check = validateFields(
          mapFieldDefs.map((d) => ({
            key: d.key,
            dataType: d.dataType as "text" | "number" | "boolean" | "date" | "url" | "select",
            options: (d.options as string[] | null) ?? undefined,
            validation: (d.validation as never[] | null) ?? undefined,
            required: false,
          })),
          input.fields,
        );
        if (!check.ok) return reply.status(400).send({ error: "invalid_fields", details: check.errors });
        newFieldValues = check.values;
      }

      let outcome:
        | { kind: "ok"; seq: number; at: string }
        | { kind: "conflict" }
        | { kind: "missing" } = { kind: "missing" };

      try {
        outcome = await db.transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(mapPlaces)
            .where(and(eq(mapPlaces.id, mpId), eq(mapPlaces.mapId, mapId), isNull(mapPlaces.deletedAt)))
            .for("update");
          if (!current) return { kind: "missing" as const };
          if (current.version !== expected) {
            return { kind: "conflict" as const };
          }

          const changedFields: string[] = [];
          if (input.sharedNote !== undefined && input.sharedNote !== current.sharedNote) {
            changedFields.push("sharedNote");
          }
          if (input.termIds !== undefined || input.primaryTermId !== undefined) changedFields.push("terms");
          if (input.fields !== undefined) changedFields.push("fields");

          const newVersion = current.version + 1;
          await tx
            .update(mapPlaces)
            .set({
              sharedNote: input.sharedNote !== undefined ? input.sharedNote : current.sharedNote,
              version: newVersion,
              updatedBy: userId,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(mapPlaces.id, mpId));

          if (input.termIds !== undefined || input.primaryTermId !== undefined) {
            await tx.delete(mapPlaceTerms).where(eq(mapPlaceTerms.mapPlaceId, mpId));
            const primary = input.primaryTermId ?? null;
            const others = (input.termIds ?? []).filter((t) => t !== primary);
            const rows = [
              ...(primary ? [{ mapPlaceId: mpId, termId: primary, role: "primary" }] : []),
              ...others.map((t) => ({ mapPlaceId: mpId, termId: t, role: null as string | null })),
            ];
            if (rows.length) await tx.insert(mapPlaceTerms).values(rows).onConflictDoNothing();
          }

          if (newFieldValues) {
            const mapFieldDefs = await tx.select().from(fieldDefinitions).where(eq(fieldDefinitions.mapId, mapId));
            for (const [key, value] of Object.entries(newFieldValues)) {
              const def = mapFieldDefs.find((d) => d.key === key);
              if (!def) continue;
              await tx
                .insert(mapPlaceFieldValues)
                .values({ mapPlaceId: mpId, fieldDefinitionId: def.id, value: value as object })
                .onConflictDoUpdate({
                  target: [mapPlaceFieldValues.mapPlaceId, mapPlaceFieldValues.fieldDefinitionId],
                  set: { value: value as object, updatedAt: new Date().toISOString() },
                });
            }
          }

          await tx.insert(placeRevisions).values({
            mapPlaceId: mpId,
            version: newVersion,
            changedBy: userId,
            changedFields,
          });

          const summary = await loadOneSummaryTx(tx, mapId, mpId, userId);
          const ev = await events.record(tx, mapId, "place.updated", summary);
          return { kind: "ok" as const, seq: ev.seq, at: ev.at };
        });
      } catch (err) {
        throw err;
      }

      if (outcome.kind === "missing") return reply.status(404).send({ error: "not_found" });
      if (outcome.kind === "conflict") {
        const current = await loadOneSummary(db, mapId, mpId, userId);
        return reply.status(409).send({
          error: "version_conflict",
          currentVersion: current?.version ?? 0,
          current,
        });
      }
      const summary = await loadOneSummary(db, mapId, mpId, userId);
      events.publish(mapId, { seq: outcome.seq, at: outcome.at }, "place.updated", summary);
      return reply.send(summary);
    });

    // --- delete (If-Match, soft) ----------------------------------------------

    app.delete("/api/maps/:mapId/map-places/:mpId", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId, mpId } = req.params as { mapId: string; mpId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      // writers may delete any bookmark; viewers only their own (checked in tx)

      const ifMatch = req.headers["if-match"];
      const expected = ifMatch ? Number(ifMatch.replace(/"/g, "")) : null;
      if (expected === null || !Number.isFinite(expected)) {
        return reply.status(428).send({ error: "if_match_required" });
      }

      const outcome = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(mapPlaces)
          .where(and(eq(mapPlaces.id, mpId), eq(mapPlaces.mapId, mapId), isNull(mapPlaces.deletedAt)))
          .for("update");
        if (!current) return { kind: "missing" as const };
        if (current.version !== expected) return { kind: "conflict" as const };
        if (!canWrite(member.role) && current.addedBy !== userId) {
          return { kind: "forbidden" as const };
        }
        await tx
          .update(mapPlaces)
          .set({ deletedAt: new Date().toISOString(), updatedBy: userId })
          .where(eq(mapPlaces.id, mpId));
        const ev = await events.record(tx, mapId, "place.deleted", {
          id: mpId,
          placeId: current.placeId,
        });
        return { kind: "ok" as const, seq: ev.seq, at: ev.at };
      });

      if (outcome.kind === "missing") return reply.status(404).send({ error: "not_found" });
      if (outcome.kind === "forbidden") return reply.status(403).send({ error: "forbidden" });
      if (outcome.kind === "conflict") {
        const current = await loadOneSummary(db, mapId, mpId, userId);
        return reply.status(409).send({
          error: "version_conflict",
          currentVersion: current?.version ?? 0,
          current,
        });
      }
      events.publish(mapId, { seq: outcome.seq, at: outcome.at }, "place.deleted", {
        id: mpId,
      });
      return reply.send({ ok: true });
    });

    // --- rating / note / comments ----------------------------------------------

    app.post("/api/maps/:mapId/map-places/:mpId/rating", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId, mpId } = req.params as { mapId: string; mpId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      const { stars } = (req.body ?? {}) as { stars?: number };
      if (!stars || !Number.isInteger(stars) || stars < 1 || stars > 5) {
        return reply.status(400).send({ error: "bad_stars" });
      }
      const outcome = await db.transaction(async (tx) => {
        const [mp] = await tx
          .select()
          .from(mapPlaces)
          .where(and(eq(mapPlaces.id, mpId), eq(mapPlaces.mapId, mapId), isNull(mapPlaces.deletedAt)));
        if (!mp) return null;
        await tx
          .insert(ratings)
          .values({ mapPlaceId: mpId, userId, stars })
          .onConflictDoUpdate({
            target: [ratings.mapPlaceId, ratings.userId],
            set: { stars, updatedAt: new Date().toISOString() },
          });
        const ev = await events.record(tx, mapId, "rating.set", { mapPlaceId: mpId, userId, stars });
        return ev;
      });
      if (!outcome) return reply.status(404).send({ error: "not_found" });
      events.publish(mapId, outcome, "rating.set", { mapPlaceId: mpId, userId, stars });
      return reply.send({ ok: true });
    });

    app.put("/api/maps/:mapId/map-places/:mpId/note", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId, mpId } = req.params as { mapId: string; mpId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      const { body, shared } = (req.body ?? {}) as { body?: string; shared?: boolean };
      if (typeof body !== "string" || body.length > 2000) {
        return reply.status(400).send({ error: "bad_body" });
      }
      const outcome = await db.transaction(async (tx) => {
        const [mp] = await tx
          .select()
          .from(mapPlaces)
          .where(and(eq(mapPlaces.id, mpId), eq(mapPlaces.mapId, mapId), isNull(mapPlaces.deletedAt)));
        if (!mp) return null;
        await tx
          .insert(notes)
          .values({ mapPlaceId: mpId, userId, body, shared: shared === true })
          .onConflictDoUpdate({
            target: [notes.mapPlaceId, notes.userId],
            set: { body, shared: shared === true, updatedAt: new Date().toISOString() },
          });
        const ev = await events.record(tx, mapId, "note.updated", {
          mapPlaceId: mpId,
          userId,
          shared: shared === true,
        });
        return ev;
      });
      if (!outcome) return reply.status(404).send({ error: "not_found" });
      events.publish(mapId, outcome, "note.updated", { mapPlaceId: mpId, userId, shared: shared === true });
      return reply.send({ ok: true });
    });

    app.get("/api/maps/:mapId/map-places/:mpId/comments", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId, mpId } = req.params as { mapId: string; mpId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      const rows = await db
        .select({ c: comments, userName: users.name })
        .from(comments)
        .innerJoin(users, eq(users.id, comments.userId))
        .where(eq(comments.mapPlaceId, mpId))
        .orderBy(comments.createdAt);
      return rows.map((r) => ({
        id: r.c.id,
        mapPlaceId: mpId,
        userId: r.c.userId,
        userName: r.userName,
        body: r.c.body,
        createdAt: r.c.createdAt,
      }));
    });

    app.post("/api/maps/:mapId/map-places/:mpId/comments", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId, mpId } = req.params as { mapId: string; mpId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      const { body } = (req.body ?? {}) as { body?: string };
      if (typeof body !== "string" || !body.trim() || body.length > 2000) {
        return reply.status(400).send({ error: "bad_body" });
      }
      const outcome = await db.transaction(async (tx) => {
        const [mp] = await tx
          .select()
          .from(mapPlaces)
          .where(and(eq(mapPlaces.id, mpId), eq(mapPlaces.mapId, mapId), isNull(mapPlaces.deletedAt)));
        if (!mp) return null;
        const [user] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
        const [c] = await tx.insert(comments).values({ mapPlaceId: mpId, userId, body: body.trim() }).returning();
        const ev = await events.record(tx, mapId, "comment.added", {
          mapPlaceId: mpId,
          commentId: c!.id,
          userId,
          userName: user?.name ?? "",
          body: body.trim(),
        });
        return { ev, comment: c!, userName: user?.name ?? "" };
      });
      if (!outcome) return reply.status(404).send({ error: "not_found" });
      events.publish(mapId, outcome.ev, "comment.added", {
        mapPlaceId: mpId,
        commentId: outcome.comment.id,
        userId,
        userName: outcome.userName,
        body: outcome.comment.body,
      });
      return reply.status(201).send({
        id: outcome.comment.id,
        mapPlaceId: mpId,
        userId,
        userName: outcome.userName,
        body: outcome.comment.body,
        createdAt: outcome.comment.createdAt,
      });
    });
  };
}

// silence unused-import lint for inArray (used in potential extensions)
void inArray;
