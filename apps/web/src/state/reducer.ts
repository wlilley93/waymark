import type { ServerEvent } from "@waymark/shared";

// Pure event reducer ([2026] VJS-CC-WAYMARK 1 D5): idempotent by construction —
// every event upserts by id, deletes by id. Replays and duplicates are safe.

export interface PlacesState {
  byId: Record<string, import("@waymark/shared").MapPlaceSummary>;
  order: string[];
}

export function emptyPlaces(): PlacesState {
  return { byId: {}, order: [] };
}

export function upsert(state: PlacesState, mp: import("@waymark/shared").MapPlaceSummary): PlacesState {
  const existed = state.byId[mp.id] !== undefined;
  return {
    byId: { ...state.byId, [mp.id]: mp },
    order: existed ? state.order : [...state.order, mp.id],
  };
}

export function applyEvent(state: PlacesState, e: ServerEvent): PlacesState {
  switch (e.type) {
    case "place.created":
    case "place.updated":
      return upsert(state, e.payload);
    case "place.deleted": {
      const byId = { ...state.byId };
      delete byId[e.payload.id];
      return { byId, order: state.order.filter((id) => id !== e.payload.id) };
    }
    case "rating.set": {
      const cur = state.byId[e.payload.mapPlaceId];
      if (!cur) return state; // not in viewport; detail refetch covers it
      return upsert(state, { ...cur, yourRating: e.payload.userId === cur.addedBy ? e.payload.stars : cur.yourRating });
    }
    case "comment.added": {
      const cur = state.byId[e.payload.mapPlaceId];
      if (!cur) return state;
      return upsert(state, { ...cur, commentCount: cur.commentCount + 1 });
    }
    case "note.updated":
    case "member.joined":
      return state;
    default:
      return state;
  }
}

export function applyEvents(state: PlacesState, events: ServerEvent[]): PlacesState {
  return events.reduce(applyEvent, state);
}
