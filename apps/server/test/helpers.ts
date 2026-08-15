import { buildApp } from "../src/app.js";
import { sql } from "drizzle-orm";
import { mkdirSync, rmSync } from "node:fs";

export async function makeTestApp() {
  const build = await buildApp({
    databaseUrl:
      process.env.DATABASE_URL ??
      "postgres://waymark:waymark@127.0.0.1:5434/waymark_test",
  });
  return build;
}

export async function truncateAll(db: import("../src/db/client.js").Db) {
  await db.execute(sql`TRUNCATE TABLE
    auth_audit, auth_tokens, sessions, users,
    memberships, invites, maps,
    map_place_field_values, field_definitions, map_place_terms, terms, facets,
    comments, notes, ratings, photos, place_revisions, map_places,
    place_sources, places, map_event_seqs, activity_events
    CASCADE`);
}

export class Jar {
  cookies = new Map<string, string>();
  absorb(response: { headers: Record<string, unknown> }) {
    const set = response.headers["set-cookie"];
    if (!set) return;
    const list = Array.isArray(set) ? set : [set];
    for (const c of list as string[]) {
      const [pair] = c.split(";");
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq)!, pair.slice(eq + 1));
    }
  }
  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

let counter = 0;
export function uniqueEmail(prefix = "user"): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@test.local`;
}

export const PHOTO_TEST_DIR = "/tmp/waymark-test-photos";
export function resetPhotoDir() {
  rmSync(PHOTO_TEST_DIR, { recursive: true, force: true });
  mkdirSync(PHOTO_TEST_DIR, { recursive: true });
}
