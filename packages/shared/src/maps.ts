import { z } from "zod";
import { latLng } from "./geo.js";

export const mapSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  defaultCamera: latLng.extend({ zoom: z.number() }).nullable(),
  createdAt: z.string(),
  createdBy: z.string(),
  yourRole: z.enum(["owner", "editor", "viewer"]).nullable(),
  memberCount: z.number().int(),
  placeCount: z.number().int(),
});
export type MapSummary = z.infer<typeof mapSummary>;

export const createMapInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  defaultCamera: latLng.extend({ zoom: z.number() }).optional(),
});
export type CreateMapInput = z.infer<typeof createMapInput>;

export const inviteRecord = z.object({
  id: z.string(),
  mapId: z.string(),
  role: z.enum(["editor", "viewer"]),
  maxUses: z.number().int().nullable(),
  uses: z.number().int(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  url: z.string().optional(),
});
export type InviteRecord = z.infer<typeof inviteRecord>;

export const createInviteInput = z.object({
  role: z.enum(["editor", "viewer"]),
  maxUses: z.number().int().min(1).max(1000).nullable().optional(),
  ttlHours: z.number().int().min(1).max(24 * 30).default(48),
});

export const memberRecord = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["owner", "editor", "viewer"]),
  joinedAt: z.string(),
});
export type MemberRecord = z.infer<typeof memberRecord>;
