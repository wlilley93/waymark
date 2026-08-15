import { describe, it, expect } from "vitest";
import { validateFields, valueSchemaFor } from "../src/fields.js";
import { parseBBoxParam } from "../src/geo.js";

describe("typed field validation", () => {
  const defs = [
    { key: "wheelchair", dataType: "select" as const, options: ["yes", "no"], required: true },
    { key: "visit_count", dataType: "number" as const, validation: [{ type: "min" as const, value: 0 }] },
    { key: "visited_on", dataType: "date" as const },
    { key: "link", dataType: "url" as const },
  ];

  it("validates select membership", () => {
    expect(validateFields(defs, { wheelchair: "yes" }).ok).toBe(true);
    const bad = validateFields(defs, { wheelchair: "maybe" });
    expect(bad.ok).toBe(false);
  });

  it("enforces required and drops empties", () => {
    const r = validateFields(defs, {});
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join()).toContain("required");
  });

  it("number min rule", () => {
    expect(validateFields(defs, { wheelchair: "no", visit_count: -1 }).ok).toBe(false);
    expect(validateFields(defs, { wheelchair: "no", visit_count: 3 }).ok).toBe(true);
  });

  it("date and url formats", () => {
    expect(validateFields(defs, { wheelchair: "no", visited_on: "2026-08-15", link: "https://x.dev" }).ok).toBe(true);
    expect(validateFields(defs, { wheelchair: "no", visited_on: "15/08/2026" }).ok).toBe(false);
    expect(validateFields(defs, { wheelchair: "no", link: "not a url" }).ok).toBe(false);
  });

  it("valueSchemaFor unknown still builds", () => {
    expect(valueSchemaFor({ dataType: "text" }).safeParse("ok").success).toBe(true);
  });
});

describe("bbox parsing", () => {
  it("parses lng,lat,lng,lat", () => {
    expect(parseBBoxParam("-1.6,53.7,-1.5,53.9")).toEqual({ minLng: -1.6, minLat: 53.7, maxLng: -1.5, maxLat: 53.9 });
  });
  it("rejects wrong arity and junk", () => {
    expect(() => parseBBoxParam("1,2,3")).toThrow();
    expect(() => parseBBoxParam("a,b,c,d")).toThrow();
  });
});
