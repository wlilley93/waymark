import { z } from "zod";

export const FACET_KEYS = [
  "category",
  "vibe",
  "occasion",
  "audience",
  "facilities",
  "price",
] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

export const facetRecord = z.object({
  id: z.string(),
  mapId: z.string(),
  key: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(300).nullable(),
});
export type FacetRecord = z.infer<typeof facetRecord>;

export const termRecord = z.object({
  id: z.string(),
  facetId: z.string(),
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().max(40).nullable(),
});
export type TermRecord = z.infer<typeof termRecord>;

export const createTermInput = z.object({
  facetId: z.string(),
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(40).optional(),
});

export const createFacetInput = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(300).optional(),
});

// Seeds applied to every new map ([2026] VJS-CC-WAYMARK 1 D2: friendly defaults,
// editable data, never code).
export const FACET_SEEDS: {
  key: FacetKey;
  name: string;
  description: string;
  terms: { name: string; color: string; icon: string | null }[];
}[] = [
  {
    key: "category",
    name: "Category",
    description: "What kind of place this is",
    terms: [
      { name: "Restaurant", color: "#e76f51", icon: "restaurant" },
      { name: "Café", color: "#e9c46a", icon: "cafe" },
      { name: "Bar", color: "#9b5de5", icon: "bar" },
      { name: "Viewpoint", color: "#00b4d8", icon: "viewpoint" },
      { name: "Park", color: "#2a9d8f", icon: "park" },
      { name: "Museum", color: "#6d597a", icon: "museum" },
      { name: "Landmark", color: "#f4a261", icon: "landmark" },
      { name: "Shop", color: "#8ab17d", icon: "shop" },
    ],
  },
  {
    key: "vibe",
    name: "Vibe",
    description: "How it feels",
    terms: [
      { name: "Cosy", color: "#d4a373", icon: null },
      { name: "Lively", color: "#ef476f", icon: null },
      { name: "Quiet", color: "#778da9", icon: null },
      { name: "Hidden gem", color: "#06d6a0", icon: null },
    ],
  },
  {
    key: "occasion",
    name: "Occasion",
    description: "What it's good for",
    terms: [
      { name: "Date", color: "#c9184a", icon: null },
      { name: "Rainy Sunday", color: "#48cae4", icon: null },
      { name: "Business", color: "#5c677d", icon: null },
      { name: "Celebration", color: "#ff9f1c", icon: null },
    ],
  },
  {
    key: "audience",
    name: "Audience",
    description: "Who it works for",
    terms: [
      { name: "Family friendly", color: "#43aa8b", icon: null },
      { name: "Good with parents", color: "#81b29a", icon: null },
      { name: "Groups", color: "#f3722c", icon: null },
    ],
  },
  {
    key: "facilities",
    name: "Facilities",
    description: "What it has",
    terms: [
      { name: "High chairs", color: "#b5838d", icon: null },
      { name: "Step-free", color: "#4cc9f0", icon: null },
      { name: "Wi-Fi", color: "#90e0ef", icon: null },
      { name: "Outdoor seating", color: "#74c69d", icon: null },
    ],
  },
  {
    key: "price",
    name: "Price",
    description: "What it costs",
    terms: [
      { name: "Budget", color: "#70e000", icon: null },
      { name: "Mid-range", color: "#ff9770", icon: null },
      { name: "Premium", color: "#c77dff", icon: null },
    ],
  },
];
