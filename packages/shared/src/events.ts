import { z } from "zod";
import { mapPlaceSummary } from "./places.js";
import { memberRecord } from "./maps.js";

// ---------------------------------------------------------------------------
// Realtime protocol ([2026] VJS-CC-WAYMARK 1 D5): persisted per-map sequences,
// resync by sinceSeq, idempotent handlers, DB is the source of truth.
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  "place.created",
  "place.updated",
  "place.deleted",
  "comment.added",
  "rating.set",
  "note.updated",
  "member.joined",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const base = {
  seq: z.number().int(),
  mapId: z.string(),
  at: z.string(),
};

export const serverEvent = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("place.created"),
    payload: mapPlaceSummary,
  }),
  z.object({
    ...base,
    type: z.literal("place.updated"),
    payload: mapPlaceSummary,
  }),
  z.object({
    ...base,
    type: z.literal("place.deleted"),
    payload: z.object({ id: z.string(), placeId: z.string() }),
  }),
  z.object({
    ...base,
    type: z.literal("comment.added"),
    payload: z.object({
      mapPlaceId: z.string(),
      commentId: z.string(),
      userId: z.string(),
      userName: z.string(),
      body: z.string(),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("rating.set"),
    payload: z.object({
      mapPlaceId: z.string(),
      userId: z.string(),
      stars: z.number().int().min(1).max(5),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("note.updated"),
    payload: z.object({
      mapPlaceId: z.string(),
      userId: z.string(),
      shared: z.boolean(),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("member.joined"),
    payload: memberRecord,
  }),
]);
export type ServerEvent = z.infer<typeof serverEvent>;

export const clientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("resync"), sinceSeq: z.number().int().min(0) }),
  z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof clientMessage>;

export const WS_PATH_PREFIX = "/api/maps/";
