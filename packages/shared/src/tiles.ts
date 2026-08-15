// Tile and terrain sources — replaceable by configuration
// ([2026] VJS-CC-WAYMARK 1 D8). No API keys anywhere.

export interface StyleDef {
  id: string;
  name: string;
  url: string;
}

export const MAP_STYLES: StyleDef[] = [
  { id: "liberty", name: "Liberty", url: "https://tiles.openfreemap.org/styles/liberty" },
  { id: "positron", name: "Positron", url: "https://tiles.openfreemap.org/styles/positron" },
  { id: "bright", name: "Bright", url: "https://tiles.openfreemap.org/styles/bright" },
  { id: "fiord", name: "Fiord", url: "https://tiles.openfreemap.org/styles/fiord" },
];

export const TERRAIN_SOURCE = {
  id: "aws-terrain",
  // AWS Terrain Tiles: public dataset, no uptime guarantee — off by default.
  tiles: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  encoding: "terrarium" as const,
  tileSize: 256,
  maxzoom: 15,
};

export const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">© OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>';

export const STYLE_STORAGE_KEY = "waymark.style";
export const TERRAIN_STORAGE_KEY = "waymark.terrain";
