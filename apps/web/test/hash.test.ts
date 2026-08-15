import { describe, it, expect } from "vitest";
import { decodeCamera, encodeCamera, DEFAULT_CAMERA } from "@waymark/shared";

describe("camera deep-link codec", () => {
  it("round-trips", () => {
    const cam = { lat: 53.8008, lng: -1.5491, zoom: 13.25, bearing: -12.5, pitch: 45, placeId: "abc-123" };
    const hash = encodeCamera(cam);
    expect(hash).toBe("#c/13.25/53.8008/-1.5491/-12.5/45/p/abc-123");
    expect(decodeCamera(hash)).toEqual(cam);
  });

  it("omits place when null", () => {
    const hash = encodeCamera({ ...DEFAULT_CAMERA, placeId: null });
    expect(hash).not.toContain("/p/");
    expect(decodeCamera(hash)?.placeId).toBeNull();
  });

  it("rejects out-of-range and garbage", () => {
    expect(decodeCamera("#c/99/0/0/0/0")).toBeNull();
    expect(decodeCamera("#c/12/999/0/0/0")).toBeNull();
    expect(decodeCamera("#whatever")).toBeNull();
    expect(decodeCamera("")).toBeNull();
  });
});
