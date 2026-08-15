// Deep-link camera codec ([2026] VJS-CC-WAYMARK 1 carry-forward FR-14):
// #c/<zoom>/<lat>/<lng>/<bearing>/<pitch>/p/<placeId>
// Ranges are validated; unknown segments are ignored forward-compatibly.

export interface CameraState {
  lat: number;
  lng: number;
  zoom: number;
  bearing: number;
  pitch: number;
  placeId: string | null;
}

export function encodeCamera(c: CameraState): string {
  const round = (n: number, d = 4) => Number(n.toFixed(d)).toString();
  const cam = `#c/${round(c.zoom, 2)}/${round(c.lat)}/${round(c.lng)}/${round(c.bearing, 1)}/${round(c.pitch, 1)}`;
  return c.placeId ? `${cam}/p/${c.placeId}` : cam;
}

export function decodeCamera(hash: string): CameraState | null {
  const m = hash.match(
    /^#c\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)(?:\/p\/([A-Za-z0-9_-]+))?/,
  );
  if (!m) return null;
  const zoom = Number(m[1]);
  const lat = Number(m[2]);
  const lng = Number(m[3]);
  const bearing = Number(m[4]);
  const pitch = Number(m[5]);
  if (
    !Number.isFinite(zoom) || zoom < 0 || zoom > 22 ||
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    !Number.isFinite(bearing) || bearing < -360 || bearing > 360 ||
    !Number.isFinite(pitch) || pitch < 0 || pitch > 85
  ) {
    return null;
  }
  return { zoom, lat, lng, bearing, pitch, placeId: m[6] ?? null };
}

export const DEFAULT_CAMERA: CameraState = {
  lat: 53.8008,
  lng: -1.5491,
  zoom: 12,
  bearing: 0,
  pitch: 0,
  placeId: null,
};
