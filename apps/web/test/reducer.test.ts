import { describe, it, expect } from "vitest";
import { applyEvent, applyEvents, emptyPlaces, upsert } from "../src/state/reducer.js";
import type { MapPlaceSummary, ServerEvent } from "@waymark/shared";

function mp(id: string, name: string): MapPlaceSummary {
  return {
    id,
    mapId: "m1",
    place: {
      id: `place-${id}`,
      name,
      location: { lat: 1, lng: 2 },
      address: null,
      website: null,
      operationalStatus: "unknown",
      osm: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    primaryTermId: null,
    termIds: [],
    sharedNote: null,
    addedBy: "u1",
    addedByName: "A",
    version: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ratingAvg: null,
    ratingCount: 0,
    yourRating: null,
    photoCount: 0,
    commentCount: 0,
  };
}

describe("event reducer (idempotent)", () => {
  it("upserts by id — duplicate created events do not duplicate entries", () => {
    const e: ServerEvent = { seq: 1, mapId: "m1", type: "place.created", at: "t", payload: mp("1", "One") };
    let s = applyEvent(emptyPlaces(), e);
    s = applyEvent(s, { ...e, seq: 2 }); // same payload, new seq (replay)
    expect(s.order).toEqual(["1"]);
    expect(Object.keys(s.byId)).toEqual(["1"]);
  });

  it("delete removes; replayed delete is a no-op", () => {
    let s = upsert(emptyPlaces(), mp("1", "One"));
    s = applyEvent(s, { seq: 2, mapId: "m1", type: "place.deleted", at: "t", payload: { id: "1", placeId: "place-1" } });
    expect(s.order).toEqual([]);
    s = applyEvent(s, { seq: 3, mapId: "m1", type: "place.deleted", at: "t", payload: { id: "1", placeId: "place-1" } });
    expect(s.order).toEqual([]);
  });

  it("updated replaces the summary wholesale", () => {
    let s = upsert(emptyPlaces(), mp("1", "One"));
    const updated = { ...mp("1", "One renamed"), version: 2 };
    s = applyEvent(s, { seq: 2, mapId: "m1", type: "place.updated", at: "t", payload: updated });
    expect(s.byId["1"]!.place.name).toBe("One renamed");
    expect(s.byId["1"]!.version).toBe(2);
  });

  it("comment.added bumps count only when in view", () => {
    let s = upsert(emptyPlaces(), { ...mp("1", "One"), commentCount: 0 });
    s = applyEvent(s, { seq: 2, mapId: "m1", type: "comment.added", at: "t", payload: { mapPlaceId: "1", commentId: "c", userId: "u2", userName: "B", body: "hi" } });
    expect(s.byId["1"]!.commentCount).toBe(1);
    const untouched = applyEvent(s, { seq: 3, mapId: "m1", type: "comment.added", at: "t", payload: { mapPlaceId: "ghost", commentId: "c2", userId: "u2", userName: "B", body: "x" } });
    expect(untouched).toBe(s);
  });

  it("ordered replay (server sends by seq) converges exactly", () => {
    const events: ServerEvent[] = [
      { seq: 1, mapId: "m1", type: "place.created", at: "t", payload: mp("1", "One") },
      { seq: 2, mapId: "m1", type: "place.created", at: "t", payload: mp("2", "Two") },
      { seq: 3, mapId: "m1", type: "place.deleted", at: "t", payload: { id: "2", placeId: "p2" } },
      { seq: 4, mapId: "m1", type: "place.created", at: "t", payload: mp("3", "Three") },
    ];
    const s = applyEvents(emptyPlaces(), events);
    expect(s.order).toEqual(["1", "3"]);
  });
});
