import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(10, "at least 10 characters")
  .max(200);

export const signupInput = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(80),
});
export type SignupInput = z.infer<typeof signupInput>;

export const loginInput = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginInput>;

export const resetRequestInput = z.object({ email: emailSchema });
export const resetInput = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const userPublic = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
export type UserPublic = z.infer<typeof userPublic>;

export const roleEnum = z.enum(["owner", "editor", "viewer"]);
export type Role = z.infer<typeof roleEnum>;
