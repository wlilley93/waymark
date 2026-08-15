import { z } from "zod";

export const FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "url",
  "select",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const fieldDefinitionRecord = z.object({
  id: z.string(),
  mapId: z.string(),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(80),
  dataType: z.enum(FIELD_TYPES),
  options: z.array(z.string().min(1).max(60)).max(30).optional(),
  applicableTermIds: z.array(z.string()).max(30).optional(),
  required: z.boolean().default(false),
  filterable: z.boolean().default(false),
});
export type FieldDefinitionRecord = z.infer<typeof fieldDefinitionRecord>;

export const createFieldDefInput = fieldDefinitionRecord.omit({
  id: true,
  mapId: true,
});

export type ValidationRule =
  | { type: "min"; value: number }
  | { type: "max"; value: number }
  | { type: "minLength"; value: number }
  | { type: "maxLength"; value: number }
  | { type: "pattern"; value: string };

export const validationRule = z.discriminatedUnion("type", [
  z.object({ type: z.literal("min"), value: z.number() }),
  z.object({ type: z.literal("max"), value: z.number() }),
  z.object({ type: z.literal("minLength"), value: z.number().int().min(0) }),
  z.object({ type: z.literal("maxLength"), value: z.number().int().min(0) }),
  z.object({ type: z.literal("pattern"), value: z.string() }),
]);

export const fieldDefWithValidation = createFieldDefInput.extend({
  validation: z.array(validationRule).max(5).optional(),
});
export type FieldDefWithValidation = z.infer<typeof fieldDefWithValidation>;

/**
 * Build a zod schema for one field value from its definition. Returns z.unknown()
 * for an unknown type so whole-record validation never hard-crashes on legacy data.
 */
export function valueSchemaFor(def: {
  dataType: FieldType;
  options?: string[];
  validation?: ValidationRule[];
}): z.ZodTypeAny {
  let s: z.ZodTypeAny;
  switch (def.dataType) {
    case "text":
      s = z.string().max(2000);
      break;
    case "number":
      s = z.number();
      break;
    case "boolean":
      s = z.boolean();
      break;
    case "date":
      s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
      break;
    case "url":
      s = z.string().url().max(500);
      break;
    case "select":
      s = z.enum((def.options ?? []) as [string, ...string[]]);
      break;
  }
  for (const rule of def.validation ?? []) {
    switch (rule.type) {
      case "min":
        s = (s as z.ZodNumber).min(rule.value) ?? s;
        break;
      case "max":
        s = (s as z.ZodNumber).max(rule.value) ?? s;
        break;
      case "minLength":
        s = (s as z.ZodString).min(rule.value) ?? s;
        break;
      case "maxLength":
        s = (s as z.ZodString).max(rule.value) ?? s;
        break;
      case "pattern":
        s = (s as z.ZodString).regex(new RegExp(rule.value)) ?? s;
        break;
    }
  }
  return s;
}

export function validateFields(
  defs: { key: string; dataType: FieldType; options?: string[]; validation?: ValidationRule[]; required?: boolean }[],
  values: Record<string, unknown>,
): { ok: true; values: Record<string, unknown> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const v = values[def.key];
    if (v === undefined || v === null || v === "") {
      if (def.required) errors.push(`${def.key}: required`);
      continue;
    }
    const parsed = valueSchemaFor(def).safeParse(v);
    if (!parsed.success) {
      errors.push(`${def.key}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      continue;
    }
    out[def.key] = parsed.data;
  }
  return errors.length ? { ok: false, errors } : { ok: true, values: out };
}
