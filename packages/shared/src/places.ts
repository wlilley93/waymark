import { z } from "zod";
import { latLng } from "./geo.js";

// ---------------------------------------------------------------------------
// Canonical place (the venue itself)
// ---------------------------------------------------------------------------

export const osmRef = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number().int().positive(),
});

export const createPlaceInput = z.object({
  name: z.string().trim().min(1).max(200),
  location: latLng,
  address: z.string().trim().max(400).optional(),
  website: z.string().url().max(500).optional(),
  osm: osmRef.optional(),
  provider: z.enum(["manual", "nominatim"]).default("manual"),
});
export type CreatePlaceInput = z.infer<typeof createPlaceInput>;

export const placeRecord = z.object({
  id: z.string(),
  name: z.string(),
  location: latLng,
  address: z.string().nullable(),
  website: z.string().nullable(),
  operationalStatus: z.enum(["operational", "closed", "unknown"]).default("unknown"),
  osm: osmRef.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PlaceRecord = z.infer<typeof placeRecord>;

// ---------------------------------------------------------------------------
// MapPlace (a group's bookmark of a place)
// ---------------------------------------------------------------------------

export const mapPlaceSummary = z.object({
  id: z.string(),
  mapId: z.string(),
  place: placeRecord,
  primaryTermId: z.string().nullable(),
  termIds: z.array(z.string()),
  sharedNote: z.string().nullable(),
  addedBy: z.string(),
  addedByName: z.string(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ratingAvg: z.number().nullable(),
  ratingCount: z.number().int(),
  yourRating: z.number().int().nullable(),
  photoCount: z.number().int(),
  commentCount: z.number().int(),
});
export type MapPlaceSummary = z.infer<typeof mapPlaceSummary>;

export const createMapPlaceInput = z.object({
  placeId: z.string().optional(),
  newPlace: createPlaceInput.optional(),
  primaryTermId: z.string().nullable().optional(),
  termIds: z.array(z.string()).max(30).default([]),
  fields: z.record(z.unknown()).default({}),
  sharedNote: z.string().trim().max(2000).optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  personalNote: z.string().trim().max(2000).optional(),
});
export type CreateMapPlaceInput = z.infer<typeof createMapPlaceInput>;

export const patchMapPlaceInput = z.object({
  sharedNote: z.string().trim().max(2000).nullable().optional(),
  primaryTermId: z.string().nullable().optional(),
  termIds: z.array(z.string()).max(30).optional(),
  fields: z.record(z.unknown()).optional(),
});
export type PatchMapPlaceInput = z.infer<typeof patchMapPlaceInput>;

export const commentRecord = z.object({
  id: z.string(),
  mapPlaceId: z.string(),
  userId: z.string(),
  userName: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type CommentRecord = z.infer<typeof commentRecord>;

export const noteRecord = z.object({
  mapPlaceId: z.string(),
  userId: z.string(),
  body: z.string(),
  shared: z.boolean(),
  updatedAt: z.string(),
});
export type NoteRecord = z.infer<typeof noteRecord>;

export const photoRecord = z.object({
  id: z.string(),
  mapPlaceId: z.string(),
  url: z.string(),
  thumbUrl: z.string(),
  caption: z.string().nullable(),
  uploadedBy: z.string(),
  createdAt: z.string(),
});
export type PhotoRecord = z.infer<typeof photoRecord>;

export const mapPlaceDetail = mapPlaceSummary.extend({
  comments: z.array(commentRecord),
  photos: z.array(photoRecord),
  yourNote: noteRecord.nullable(),
  sharedNotes: z.array(noteRecord),
  fieldValues: z.record(z.unknown()),
  revisions: z
    .array(
      z.object({
        version: z.number().int(),
        changedBy: z.string(),
        changedByName: z.string(),
        changedFields: z.array(z.string()),
        createdAt: z.string(),
      }),
    )
    .max(50),
});
export type MapPlaceDetail = z.infer<typeof mapPlaceDetail>;

export const conflictBody = z.object({
  error: z.literal("version_conflict"),
  currentVersion: z.number().int(),
  current: mapPlaceSummary,
});
export type ConflictBody = z.infer<typeof conflictBody>;

export const viewportQuery = z.object({
  bbox: z.string(),
  termIds: z.string().optional(),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  mine: z.coerce.boolean().optional(),
  authorId: z.string().optional(),
});
export type ViewportQuery = z.infer<typeof viewportQuery>;

export const nearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(10).max(100000).default(2000),
  termId: z.string().optional(),
  likeMapPlaceId: z.string().optional(),
});
export type NearbyQuery = z.infer<typeof nearbyQuery>;
