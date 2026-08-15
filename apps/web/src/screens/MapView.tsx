import { Button, Input, Select, Textarea, Option } from "../ui/controls.js";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { MapPlaceSummary } from "@waymark/shared";
import { ATTRIBUTION, MAP_STYLES, STYLE_STORAGE_KEY, TERRAIN_SOURCE, TERRAIN_STORAGE_KEY } from "@waymark/shared";
import { useStore } from "../state/store.js";

maplibregl.prewarm();

type MapRef = maplibregl.Map;

interface Props {
  onViewport: (bbox: [number, number, number, number]) => void;
  onPick: (lng: number, lat: number) => void;
  pickMode: boolean;
}

export function MapView({ onViewport, onPick, pickMode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapRef | null>(null);
  const loadedRef = useRef(false);
  const pickRef = useRef(pickMode);
  pickRef.current = pickMode;
  const viewportRef = useRef(onViewport);
  viewportRef.current = onViewport;
  const pickHandlerRef = useRef(onPick);
  pickHandlerRef.current = onPick;

  const places = useStore((s) => s.places);
  const current = useStore((s) => s.current);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const terms = current?.terms ?? [];

  // one-time map init
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const styleUrl =
      MAP_STYLES.find((s) => s.id === localStorage.getItem(STYLE_STORAGE_KEY))?.url ??
      MAP_STYLES[0]!.url;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: [-1.5491, 53.8008],
      zoom: 12,
      attributionControl: { compact: true, customAttribution: ATTRIBUTION },
    });
    mapRef.current = map;
    (window as unknown as { __map?: MapRef }).__map = map; // debug/test hook
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }));
    map.addControl(new maplibregl.ScaleControl({}));
    map.addControl(new maplibregl.FullscreenControl({}));

    const addDataLayers = () => {
      map.addSource("places", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: 46,
        clusterMaxZoom: 12,
      });
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "places",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#4f6df5",
          "circle-opacity": 0.75,
          "circle-radius": ["step", ["get", "point_count"], 15, 10, 20, 50, 27],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "places",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 13,
        },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "places-circle",
        type: "circle",
        source: "places",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 12, 7.5],
          "circle-stroke-width": ["case", ["boolean", ["feature-state", "selected"], false], 3.5, 2],
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "places-label",
        type: "symbol",
        source: "places",
        filter: ["!", ["has", "point_count"]],
        minzoom: 13,
        layout: {
          "text-field": ["get", "name"],
          "text-offset": [0, 1.3],
          "text-anchor": "top",
          "text-size": 12,
          "text-font": ["Noto Sans Regular"],
        },
        paint: {
          "text-color": "#20232b",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.4,
        },
      });
    };

    map.on("style.load", () => {
      if (!loadedRef.current) {
        loadedRef.current = true;
        // first style load: data layers + terrain if enabled
        addDataLayers();
        if (localStorage.getItem(TERRAIN_STORAGE_KEY) === "on") enableTerrain(map);
        map.resize();
      } else {
        // style was swapped: re-add data layers; terrain re-enabled on demand
        addDataLayers();
        if (localStorage.getItem(TERRAIN_STORAGE_KEY) === "on") enableTerrain(map);
      }
    });

    map.on("click", "clusters", (e) => {
      const features = e.features ?? [];
      const cluster = features[0];
      if (!cluster) return;
      const src = map.getSource("places") as maplibregl.GeoJSONSource;
      void src.getClusterExpansionZoom(Number(cluster.properties?.cluster_id)).then((zoom) => {
        map.easeTo({
          center: (cluster.geometry as { coordinates: [number, number] }).coordinates,
          zoom,
        });
      });
    });

    map.on("click", "places-circle", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const id = f.properties?.mpId as string;
      if (id) select(id);
    });

    map.on("click", (e) => {
      if (pickRef.current) {
        pickHandlerRef.current(e.lngLat.lng, e.lngLat.lat);
      }
    });

    map.on("mouseenter", "places-circle", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "places-circle", () => (map.getCanvas().style.cursor = ""));

    let debounce: ReturnType<typeof setTimeout> | undefined;
    map.on("moveend", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const b = map.getBounds();
        viewportRef.current([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
        syncHash(map);
      }, 220);
    });

    // restore camera from a deep link
    const h = location.hash;
    if (h.startsWith("#c/")) {
      import("@waymark/shared").then(({ decodeCamera }) => {
        const cam = decodeCamera(h);
        if (cam) map.jumpTo({ center: [cam.lng, cam.lat], zoom: cam.zoom, bearing: cam.bearing, pitch: cam.pitch });
      });
    }

    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  // pick mode cursor
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode]);

  // push places into the geojson source
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const src = map.getSource("places") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const features = places.order.map((id) => {
      const mp: MapPlaceSummary = places.byId[id]!;
      const color = terms.find((t) => t.id === mp.primaryTermId)?.color ?? "#5b6472";
      return {
        type: "Feature" as const,
        id: idToNumeric(id),
        geometry: { type: "Point" as const, coordinates: [mp.place.location.lng, mp.place.location.lat] },
        properties: { mpId: mp.id, name: mp.place.name, color },
      };
    });
    src.setData({ type: "FeatureCollection", features });

    // selection highlight
    for (const id of places.order) {
      const numId = idToNumeric(id);
      map.setFeatureState({ source: "places", id: numId }, { selected: id === selectedId });
    }
  }, [places, terms, selectedId]);

  // fly to selection
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const mp = places.byId[selectedId];
    if (mp) {
      map.easeTo({ center: [mp.place.location.lng, mp.place.location.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
    }
  }, [selectedId, places]);

  const styleId =
    MAP_STYLES.find((s) => s.id === localStorage.getItem(STYLE_STORAGE_KEY))?.id ?? MAP_STYLES[0]!.id;
  const terrainOn = localStorage.getItem(TERRAIN_STORAGE_KEY) === "on";

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map-canvas" />
      <div className="map-controls">
        <Select
          value={styleId}
          onChange={(e) => {
            const style = MAP_STYLES.find((s) => s.id === e.target.value)!;
            localStorage.setItem(STYLE_STORAGE_KEY, style.id);
            mapRef.current?.setStyle(style.url);
          }}
          aria-label="Map style"
        >
          {MAP_STYLES.map((s) => (
            <Option key={s.id} value={s.id}>
              {s.name}
            </Option>
          ))}
        </Select>
        <Button
          className={terrainOn ? "on" : ""}
          onClick={() => {
            const map = mapRef.current;
            if (!map) return;
            const next = !terrainOn;
            localStorage.setItem(TERRAIN_STORAGE_KEY, next ? "on" : "off");
            if (next) {
              enableTerrain(map);
            } else {
              map.setTerrain(null);
              const src = map.getSource(TERRAIN_SOURCE.id);
              if (src) map.removeSource(TERRAIN_SOURCE.id);
            }
            // re-render button state
            useStore.setState({ mapError: useStore.getState().mapError });
          }}
        >
          3D
        </Button>
      </div>
    </div>
  );
}

function enableTerrain(map: MapRef) {
  if (!map.getSource(TERRAIN_SOURCE.id)) {
    map.addSource(TERRAIN_SOURCE.id, {
      type: "raster-dem",
      tiles: [TERRAIN_SOURCE.tiles],
      tileSize: TERRAIN_SOURCE.tileSize,
      encoding: TERRAIN_SOURCE.encoding,
      maxzoom: TERRAIN_SOURCE.maxzoom,
    });
  }
  map.setTerrain({ source: TERRAIN_SOURCE.id, exaggeration: 1.15 });
}

function syncHash(map: MapRef) {
  const c = map.getCenter();
  const zoom = map.getZoom();
  const bearing = map.getBearing();
  const pitch = map.getPitch();
  const selected = useStore.getState().selectedId;
  const round = (n: number, d = 4) => Number(n.toFixed(d)).toString();
  const cam = `#c/${round(zoom, 2)}/${round(c.lat)}/${round(c.lng)}/${round(bearing, 1)}/${round(pitch, 1)}`;
  history.replaceState(null, "", selected ? `${cam}/p/${selected}` : cam);
}

function idToNumeric(id: string): number {
  // stable numeric feature id from uuid for feature-state
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
