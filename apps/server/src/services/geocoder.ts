// Geocoder provider interface ([2026] VJS-CC-WAYMARK 1 D7).
// The public Nominatim adapter serves EXPLICIT SUBMITTED QUERIES only —
// no keystroke autocomplete, proper UA, >=1s spacing, cached results.

export interface GeocodeResult {
  name: string;
  lat: number;
  lng: number;
  address?: string;
  website?: string;
  osm?: { type: "node" | "way" | "relation"; id: number };
}

export interface Geocoder {
  readonly id: string;
  search(query: string, near?: { lat: number; lng: number }): Promise<GeocodeResult[]>;
}

export class NominatimAdapter implements Geocoder {
  readonly id = "nominatim";
  private lastCall = 0;
  private cache = new Map<string, { at: number; results: GeocodeResult[] }>();
  private readonly minSpacingMs = 1100;
  private readonly cacheTtlMs = 10 * 60 * 1000;

  constructor(private readonly endpoint = "https://nominatim.openstreetmap.org/search") {}

  async search(query: string, near?: { lat: number; lng: number }): Promise<GeocodeResult[]> {
    const key = `${query}|${near ? `${near.lat.toFixed(3)},${near.lng.toFixed(3)}` : ""}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.cacheTtlMs) return hit.results;

    const wait = this.lastCall + this.minSpacingMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();

    const url = new URL(this.endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "8");
    if (near) {
      url.searchParams.set("viewbox", [
        (near.lng - 0.5).toFixed(5),
        (near.lat + 0.3).toFixed(5),
        (near.lng + 0.5).toFixed(5),
        (near.lat - 0.3).toFixed(5),
      ].join(","));
    }

    const res = await fetch(url, {
      headers: {
        // OSM usage policy requires a identifying UA.
        "User-Agent": "Waymark/0.1 (self-hosted map bookmarks; dev deployment)",
        "Accept-Language": "en",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const json = (await res.json()) as Array<{
      name?: string;
      display_name: string;
      lat: string;
      lon: string;
      website?: string;
      osm_type?: string;
      osm_id?: number;
      address?: Record<string, string>;
    }>;

    const results: GeocodeResult[] = json.slice(0, 8).map((r) => ({
      name: r.name || r.display_name.split(",")[0] || r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
      address: r.display_name,
      website: r.website,
      osm:
        r.osm_type && r.osm_id && ["node", "way", "relation"].includes(r.osm_type)
          ? { type: r.osm_type as "node" | "way" | "relation", id: r.osm_id }
          : undefined,
    }));
    this.cache.set(key, { at: Date.now(), results });
    return results;
  }
}

const registry = new Map<string, Geocoder>();

export function registerGeocoder(g: Geocoder) {
  registry.set(g.id, g);
}

registerGeocoder(new NominatimAdapter());

// test seam: a fresh adapter instance (own spacing/clock state)
export function makeNominatimAdapter(endpoint = "https://nominatim.openstreetmap.org/search") {
  return new NominatimAdapter(endpoint);
}

export function getGeocoder(id = "nominatim"): Geocoder {
  const g = registry.get(id);
  if (!g) throw new Error(`unknown geocoder: ${id}`);
  return g;
}

export function listGeocoders(): string[] {
  return [...registry.keys()];
}

// Test seam: swap the default geocoder without the network.
export function __setTestGeocoder(g: Geocoder | null) {
  if (g) registry.set(g.id, g);
  else registry.delete("nominatim");
}
