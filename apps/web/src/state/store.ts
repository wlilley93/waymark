import { create } from "zustand";
import type { MapPlaceSummary, MapSummary, FacetRecord, TermRecord, FieldDefinitionRecord, UserPublic } from "@waymark/shared";
import { api, type MapDetailBundle } from "../api/client.js";
import { applyEvent, emptyPlaces, upsert, type PlacesState } from "./reducer.js";
import type { ServerEvent } from "@waymark/shared";

export interface Filters {
  termIds: string[];
  minRating: number | undefined;
  mine: boolean;
}

interface WaymarkStore {
  user: UserPublic | null;
  authChecked: boolean;
  maps: MapSummary[];
  current: MapDetailBundle | null;
  places: PlacesState;
  filters: Filters;
  selectedId: string | null;
  mapError: string | null;

  setUser: (u: UserPublic | null) => void;
  setAuthChecked: (v: boolean) => void;
  loadMaps: () => Promise<void>;
  openMap: (mapId: string) => Promise<void>;
  closeMap: () => void;
  setPlaces: (list: MapPlaceSummary[]) => void;
  mergePlaces: (list: MapPlaceSummary[]) => void;
  applyServerEvent: (e: ServerEvent) => void;
  setFilters: (f: Partial<Filters>) => void;
  select: (id: string | null) => void;
  refreshSelected: () => Promise<void>;
}

export const useStore = create<WaymarkStore>((set, get) => ({
  user: null,
  authChecked: false,
  maps: [],
  current: null,
  places: emptyPlaces(),
  filters: { termIds: [], minRating: undefined, mine: false },
  selectedId: null,
  mapError: null,

  setUser: (user) => set({ user }),
  setAuthChecked: (authChecked) => set({ authChecked }),

  loadMaps: async () => {
    const maps = await api.listMaps();
    set({ maps });
  },

  openMap: async (mapId) => {
    set({ mapError: null });
    try {
      const current = await api.getMap(mapId);
      const fields = await api.fields(mapId);
      set({
        current: { ...current, terms: current.terms, facets: current.facets } as MapDetailBundle & { fields?: FieldDefinitionRecord[] },
        places: emptyPlaces(),
        selectedId: null,
        maps: get().maps.some((m) => m.id === mapId) ? get().maps : get().maps,
      });
      // stash field definitions on the store via a side channel for simplicity
      (get() as WaymarkStore & { fieldDefs?: FieldDefinitionRecord[] }).fieldDefs = fields;
      await get().loadMaps();
    } catch (e) {
      set({ mapError: (e as Error).message });
    }
  },

  closeMap: () => set({ current: null, places: emptyPlaces(), selectedId: null }),

  setPlaces: (list) =>
    set({
      places: list.reduce((acc, mp) => upsert(acc, mp), emptyPlaces()),
    }),

  mergePlaces: (list) => set((s) => ({ places: list.reduce((acc, mp) => upsert(acc, mp), s.places) })),

  applyServerEvent: (e) =>
    set((s) => {
      // place.updated/created outside the current viewport are still merged —
      // the map layer culls by bbox at render time
      return { places: applyEvent(s.places, e) };
    }),

  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),

  select: (selectedId) => set({ selectedId }),

  refreshSelected: async () => {
    const { current, selectedId } = get();
    if (!current || !selectedId) return;
    try {
      const detail = await api.mapPlace(current.map.id, selectedId);
      set((s) => ({ places: upsert(s.places, detail) }));
    } catch {
      /* deleted or raced; the reducer handles removal via events */
    }
  },
}));

export function termColor(termId: string | undefined, terms: TermRecord[], facets: FacetRecord[] | undefined): string {
  void facets;
  const t = terms.find((x) => x.id === termId);
  return t?.color ?? "#7a828f";
}
