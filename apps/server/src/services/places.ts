import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db, DbTx } from "../db/client.js";
import {
  mapPlaces,
  mapPlaceTerms,
  memberships,
  photos,
  places,
  placeSources,
  ratings,
  comments,
  notes,
  users,
  terms,
  facets,
  fieldDefinitions,
  mapPlaceFieldValues,
  placeRevisions,
} from "../db/schema.js";
import type { MapPlaceDetail, MapPlaceSummary, PlaceRecord } from "@waymark/shared";
import type { EventPublisher } from "./events.js";

// Row shape straight from the common viewport join
interface JoinedRow {
  mp: typeof mapPlaces.$inferSelect;
  place: typeof places.$inferSelect;
  addedByName: string;
}

export function placeToRecord(p: typeof places.$inferSelect): PlaceRecord {
  return {
    id: p.id,
    name: p.name,
    location: p.location,
    address: p.address,
    website: p.website,
    operationalStatus: p.operationalStatus as PlaceRecord["operationalStatus"],
    osm: null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * Canonical place creation with source-key dedupe
 * ([2026] VJS-CC-WAYMARK 1 D1): (provider, external_id) wins; manual pins
 * reuse an exact name+<5m match before inserting.
 */
export async function upsertPlace(
  db: Db | DbTx,
  input: {
    name: string;
    location: { lat: number; lng: number };
    address?: string;
    website?: string;
    osm?: { type: string; id: number };
    provider: string;
    createdBy: string;
  },
): Promise<typeof places.$inferSelect> {
  if (input.osm) {
    const externalId = `${input.osm.type}/${input.osm.id}`;
    const existing = await db
      .select({ place: places })
      .from(placeSources)
      .innerJoin(places, eq(places.id, placeSources.placeId))
      .where(
        and(
          eq(placeSources.provider, input.provider === "nominatim" ? "nominatim" : input.provider),
          eq(placeSources.externalId, externalId),
          isNull(places.deletedAt),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0].place;
    // also try the osm provider namespace (a nominatim hit and a manual osm paste
    // are the same venue)
    const viaOsm = await db
      .select({ place: places })
      .from(placeSources)
      .innerJoin(places, eq(places.id, placeSources.placeId))
      .where(and(eq(placeSources.provider, "osm"), eq(placeSources.externalId, externalId), isNull(places.deletedAt)))
      .limit(1);
    if (viaOsm[0]) return viaOsm[0].place;
  }

  const nearDupe = await db
    .select()
    .from(places)
    .where(
      and(
        isNull(places.deletedAt),
        sql`lower(${places.name}) = lower(${input.name})`,
        sql`ST_DWithin(${places.location}, ST_SetSRID(ST_MakePoint(${input.location.lng}, ${input.location.lat}), 4326)::geography, 5)`,
      ),
    )
    .limit(1);
  if (nearDupe[0]) return nearDupe[0];

  const [created] = await db
    .insert(places)
    .values({
      name: input.name,
      location: input.location,
      address: input.address ?? null,
      website: input.website ?? null,
      createdBy: input.createdBy,
    })
    .returning();
  const place = created!;

  const externalId = input.osm ? `${input.osm.type}/${input.osm.id}` : `manual/${place.id}`;
  await db.insert(placeSources).values({
    placeId: place.id,
    provider: input.osm ? (input.provider === "nominatim" ? "nominatim" : "osm") : "manual",
    externalId,
    metadata: input.osm ? { osm: input.osm } : null,
  });
  return place;
}

export async function loadSummaries(
  db: Db,
  mapId: string,
  mpIds: string[],
  viewerId: string | null,
): Promise<MapPlaceSummary[]> {
  if (mpIds.length === 0) return [];
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
      termIds: sql<string[]>`(
        SELECT coalesce(array_agg(t.term_id::text), '{}')
        FROM map_place_terms t WHERE t.map_place_id = ${mapPlaces.id})`,
      primaryTermId: sql<string | null>`(
        SELECT t.term_id::text FROM map_place_terms t
        WHERE t.map_place_id = ${mapPlaces.id} AND t.role = 'primary' LIMIT 1)`,
    })
    .from(mapPlaces)
    .innerJoin(places, eq(places.id, mapPlaces.placeId))
    .innerJoin(users, eq(users.id, mapPlaces.addedBy))
    .where(
      and(
        eq(mapPlaces.mapId, mapId),
        isNull(mapPlaces.deletedAt),
        sql`${mapPlaces.id} IN (${sql.join(
          mpIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      ),
    );

  return rows.map(toSummary);
}

export function toSummary(row: {
  mp: typeof mapPlaces.$inferSelect;
  place: typeof places.$inferSelect;
  addedByName: string;
  ratingAvg: number | null;
  ratingCount: number;
  yourRating: number | null;
  photoCount: number;
  commentCount: number;
  termIds: string[];
  primaryTermId: string | null;
}): MapPlaceSummary {
  return {
    id: row.mp.id,
    mapId: row.mp.mapId,
    place: {
      id: row.place.id,
      name: row.place.name,
      location: row.place.location,
      address: row.place.address,
      website: row.place.website,
      operationalStatus: row.place.operationalStatus as PlaceRecord["operationalStatus"],
      osm: null,
      createdAt: row.place.createdAt,
      updatedAt: row.place.updatedAt,
    },
    primaryTermId: row.primaryTermId,
    termIds: row.termIds ?? [],
    sharedNote: row.mp.sharedNote,
    addedBy: row.mp.addedBy,
    addedByName: row.addedByName,
    version: row.mp.version,
    createdAt: row.mp.createdAt,
    updatedAt: row.mp.updatedAt,
    ratingAvg: row.ratingAvg === null ? null : Number(row.ratingAvg),
    ratingCount: Number(row.ratingCount),
    yourRating: row.yourRating === null ? null : Number(row.yourRating),
    photoCount: Number(row.photoCount),
    commentCount: Number(row.commentCount),
  };
}

export async function loadOneSummary(
  db: Db,
  mapId: string,
  mpId: string,
  viewerId: string | null,
): Promise<MapPlaceSummary | null> {
  const list = await loadSummaries(db, mapId, [mpId], viewerId);
  return list[0] ?? null;
}

export async function loadDetail(
  db: Db,
  mapId: string,
  mpId: string,
  viewerId: string,
): Promise<MapPlaceDetail | null> {
  const summary = await loadOneSummary(db, mapId, mpId, viewerId);
  if (!summary) return null;

  const [commentRows, photoRows, noteRows, fieldRows, revisionRows] = await Promise.all([
    db
      .select({ c: comments, userName: users.name })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .where(eq(comments.mapPlaceId, mpId))
      .orderBy(comments.createdAt),
    db.select().from(photos).where(eq(photos.mapPlaceId, mpId)).orderBy(photos.createdAt),
    db
      .select({ n: notes, userName: users.name })
      .from(notes)
      .innerJoin(users, eq(users.id, notes.userId))
      .where(eq(notes.mapPlaceId, mpId)),
    db
      .select({ fd: fieldDefinitions, value: mapPlaceFieldValues.value })
      .from(mapPlaceFieldValues)
      .innerJoin(fieldDefinitions, eq(fieldDefinitions.id, mapPlaceFieldValues.fieldDefinitionId))
      .where(eq(mapPlaceFieldValues.mapPlaceId, mpId)),
    db
      .select({ r: placeRevisions, userName: users.name })
      .from(placeRevisions)
      .innerJoin(users, eq(users.id, placeRevisions.changedBy))
      .where(eq(placeRevisions.mapPlaceId, mpId))
      .orderBy(sql`${placeRevisions.version} DESC`)
      .limit(50),
  ]);

  const fieldValues: Record<string, unknown> = {};
  for (const f of fieldRows) fieldValues[f.fd.key] = f.value;

  return {
    ...summary,
    comments: commentRows.map((r) => ({
      id: r.c.id,
      mapPlaceId: r.c.mapPlaceId,
      userId: r.c.userId,
      userName: r.userName,
      body: r.c.body,
      createdAt: r.c.createdAt,
    })),
    photos: photoRows.map((p) => ({
      id: p.id,
      mapPlaceId: p.mapPlaceId,
      url: `/api/photos/${p.id}`,
      thumbUrl: `/api/photos/${p.id}?thumb=1`,
      caption: p.caption,
      uploadedBy: p.uploadedBy,
      createdAt: p.createdAt,
    })),
    yourNote:
      noteRows.find((r) => r.n.userId === viewerId)
        ? {
            mapPlaceId: mpId,
            userId: viewerId,
            body: noteRows.find((r) => r.n.userId === viewerId)!.n.body,
            shared: noteRows.find((r) => r.n.userId === viewerId)!.n.shared,
            updatedAt: noteRows.find((r) => r.n.userId === viewerId)!.n.updatedAt,
          }
        : null,
    sharedNotes: noteRows
      .filter((r) => r.n.shared && r.n.userId !== viewerId)
      .map((r) => ({
        mapPlaceId: mpId,
        userId: r.n.userId,
        body: r.n.body,
        shared: true,
        updatedAt: r.n.updatedAt,
      })),
    fieldValues,
    revisions: revisionRows.map((r) => ({
      version: r.r.version,
      changedBy: r.r.changedBy,
      changedByName: r.userName,
      changedFields: (r.r.changedFields as string[]) ?? [],
      createdAt: r.r.createdAt,
    })),
  };
}

export async function requireMembership(
  db: Db,
  mapId: string,
  userId: string,
): Promise<{ role: string } | null> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.mapId, mapId), eq(memberships.userId, userId)));
  return row ?? null;
}

export function canWrite(role: string | undefined | null): boolean {
  return role === "owner" || role === "editor";
}

export { terms, facets };
