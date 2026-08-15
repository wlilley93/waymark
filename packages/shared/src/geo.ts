import { z } from "zod";

export const latLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof latLng>;

export const bbox = z.object({
  minLat: z.number().min(-90).max(90),
  minLng: z.number().min(-180).max(180),
  maxLat: z.number().min(-90).max(90),
  maxLng: z.number().min(-180).max(180),
});
export type BBox = z.infer<typeof bbox>;

export function parseBBoxParam(raw: string): BBox {
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error("bbox must be minLng,minLat,maxLng,maxLat");
  }
  const [minLng, minLat, maxLng, maxLat] = parts;
  return bbox.parse({ minLat, minLng, maxLat, maxLng });
}
