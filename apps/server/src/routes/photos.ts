import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { mapPlaces, photos } from "../db/schema.js";
import { requireAuth } from "../plugins/session.js";
import { canWrite, requireMembership } from "../services/places.js";

const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export function buildPhotoRoutes(db: Db, photoDir: string) {
  return async function photoRoutes(app: FastifyInstance) {
    app.post("/api/maps/:mapId/map-places/:mpId/photos", async (req, reply) => {
      const userId = requireAuth(req);
      const { mapId, mpId } = req.params as { mapId: string; mpId: string };
      const member = await requireMembership(db, mapId, userId);
      if (!member || !canWrite(member.role)) return reply.status(403).send({ error: "forbidden" });

      const file = await req.file();
      if (!file) return reply.status(400).send({ error: "no_file" });
      const ext = ALLOWED.get(file.mimetype);
      if (!ext) return reply.status(415).send({ error: "unsupported_media_type" });

      const [mp] = await db
        .select()
        .from(mapPlaces)
        .where(and(eq(mapPlaces.id, mpId), eq(mapPlaces.mapId, mapId), isNull(mapPlaces.deletedAt)));
      if (!mp) return reply.status(404).send({ error: "not_found" });

      const captionField = file.fields["caption"];
      const caption =
        captionField && !Array.isArray(captionField) && "value" in captionField
          ? String(captionField.value)
          : null;
      const id = randomUUID();
      const dir = path.join(photoDir, mapId);
      await mkdir(dir, { recursive: true });
      const full = path.join(dir, `${id}.${ext}`);
      const thumb = path.join(dir, `${id}.thumb.webp`);

      const buf = await file.toBuffer();
      if (buf.byteLength > 15 * 1024 * 1024) return reply.status(413).send({ error: "too_large" });
      await writeFile(full, buf);
      await sharp(buf).resize(320, 320, { fit: "inside" }).webp({ quality: 75 }).toFile(thumb);

      const [row] = await db
        .insert(photos)
        .values({ id, mapPlaceId: mpId, path: full, thumbPath: thumb, caption, uploadedBy: userId })
        .returning();

      // photo adds bump nothing versional — they are append-only; but the
      // summary counts change, so notify with a fresh summary (no version bump:
      // photos never conflict with If-Match edits)
      return reply.status(201).send({
        id: row!.id,
        mapPlaceId: mpId,
        url: `/api/photos/${row!.id}`,
        thumbUrl: `/api/photos/${row!.id}?thumb=1`,
        caption: row!.caption,
        uploadedBy: userId,
        createdAt: row!.createdAt,
      });
      // NB: no WS event for photo adds — every broadcast must be persisted
      // transactionally first ([2026] VJS-CC-WAYMARK 1 forbidden limb); photo
      // counts refresh on the next detail fetch.
    });

    app.get("/api/photos/:photoId", async (req, reply) => {
      const userId = requireAuth(req);
      const { photoId } = req.params as { photoId: string };
      const thumb = (req.query as { thumb?: string }).thumb === "1";
      const [row] = await db.select().from(photos).where(eq(photos.id, photoId));
      if (!row) return reply.status(404).send({ error: "not_found" });
      // authorisation: any member of the owning map
      const [mp] = await db.select().from(mapPlaces).where(eq(mapPlaces.id, row.mapPlaceId));
      if (!mp) return reply.status(404).send({ error: "not_found" });
      const member = await requireMembership(db, mp.mapId, userId);
      if (!member) return reply.status(403).send({ error: "not_a_member" });
      const p = thumb ? row.thumbPath : row.path;
      const stream = createReadStream(p);
      return reply.type(thumb ? "image/webp" : `image/${p.split(".").pop()}`).send(stream);
    });
  };
}
