import { customType, index, uniqueIndex } from "drizzle-orm/pg-core";
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// geography(Point,4326) — SRID-fixed point with metre semantics for ST_DWithin.
export const geographyPoint = customType<{
  data: { lat: number; lng: number };
  driverData: string;
}>({
  dataType() {
    return "geography(Point,4326)";
  },
  toDriver(value) {
    return `SRID=4326;POINT(${value.lng} ${value.lat})`;
  },
  fromDriver(value: string) {
    // postgres.js returns geography as EWKB hex: 01(byte order)+4(type)+4(SRID)+16(coords)
    if (/^[0-9a-fA-F]+$/.test(value) && value.length >= 50) {
      const littleEndian = value.slice(0, 2) === "01";
      const buf = Buffer.from(value.slice(-32), "hex"); // X (lng), Y (lat)
      const read = littleEndian
        ? (o: number) => buf.readDoubleLE(o)
        : (o: number) => buf.readDoubleBE(o);
      const lng = read(0);
      const lat = read(8);
      if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat };
    }
    const m = value.match(/POINT\((-?[\d.]+) (-?[\d.]+)\)/);
    if (!m) throw new Error(`unparseable point: ${value}`);
    return { lng: Number(m[1]), lat: Number(m[2]) };
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: ts("email_verified_at"),
    deletedAt: ts("deleted_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 of the cookie token
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const authAudit = pgTable(
  "auth_audit",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    ip: text("ip"),
    detail: jsonb("detail"),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("auth_audit_user_idx").on(t.userId)],
);

// Single-use hashed tokens: password reset + email verification
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // password_reset | email_verify
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash)],
);

// ---------------------------------------------------------------------------
// Maps, membership, invites
// ---------------------------------------------------------------------------

export const maps = pgTable("maps", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  defaultCamera: jsonb("default_camera"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

export const memberships = pgTable(
  "memberships",
  {
    mapId: uuid("map_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // owner | editor | viewer
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.mapId, t.userId] }),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mapId: uuid("map_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    role: text("role").notNull(), // editor | viewer
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("invites_token_uq").on(t.tokenHash)],
);

// ---------------------------------------------------------------------------
// Places: the three-layer model ([2026] VJS-CC-WAYMARK 1 D1)
// ---------------------------------------------------------------------------

export const places = pgTable(
  "places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    location: geographyPoint("location").notNull(),
    address: text("address"),
    website: text("website"),
    operationalStatus: text("operational_status").notNull().default("unknown"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("places_location_gix").using("gist", t.location),
    index("places_name_idx").on(sql`lower(${t.name})`),
  ],
);

export const placeSources = pgTable(
  "place_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // manual | nominatim | osm | import
    externalId: text("external_id").notNull(),
    metadata: jsonb("metadata"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("place_sources_provider_uq").on(t.provider, t.externalId),
    index("place_sources_place_idx").on(t.placeId),
  ],
);

export const mapPlaces = pgTable(
  "map_places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mapId: uuid("map_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    sharedNote: text("shared_note"),
    version: integer("version").notNull().default(1),
    addedBy: uuid("added_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    // one live bookmark per (map, place); soft-deleted rows keep history
    uniqueIndex("map_places_live_uq")
      .on(t.mapId, t.placeId)
      .where(sql`${t.deletedAt} IS NULL`),
    index("map_places_map_idx").on(t.mapId),
  ],
);

export const placeRevisions = pgTable(
  "place_revisions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    mapPlaceId: uuid("map_place_id")
      .notNull()
      .references(() => mapPlaces.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    changedBy: uuid("changed_by")
      .notNull()
      .references(() => users.id),
    changedFields: jsonb("changed_fields").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("place_revisions_mp_idx").on(t.mapPlaceId)],
);

// ---------------------------------------------------------------------------
// Taxonomy: facets and terms ([2026] VJS-CC-WAYMARK 1 D2)
// ---------------------------------------------------------------------------

export const facets = pgTable(
  "facets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mapId: uuid("map_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("facets_map_key_uq").on(t.mapId, t.key)],
);

export const terms = pgTable(
  "terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facetId: uuid("facet_id")
      .notNull()
      .references(() => facets.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    icon: text("icon"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("terms_facet_name_uq").on(t.facetId, t.name)],
);

export const mapPlaceTerms = pgTable(
  "map_place_terms",
  {
    mapPlaceId: uuid("map_place_id")
      .notNull()
      .references(() => mapPlaces.id, { onDelete: "cascade" }),
    termId: uuid("term_id")
      .notNull()
      .references(() => terms.id, { onDelete: "cascade" }),
    role: text("role"), // primary | secondary — only meaningful in the category facet
  },
  (t) => [primaryKey({ columns: [t.mapPlaceId, t.termId] })],
);

// ---------------------------------------------------------------------------
// Typed custom fields ([2026] VJS-CC-WAYMARK 1 D3)
// ---------------------------------------------------------------------------

export const fieldDefinitions = pgTable(
  "field_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mapId: uuid("map_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    dataType: text("data_type").notNull(),
    options: jsonb("options"),
    applicableTermIds: jsonb("applicable_term_ids"),
    validation: jsonb("validation"),
    required: boolean("required").notNull().default(false),
    filterable: boolean("filterable").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("field_definitions_map_key_uq").on(t.mapId, t.key)],
);

export const mapPlaceFieldValues = pgTable(
  "map_place_field_values",
  {
    mapPlaceId: uuid("map_place_id")
      .notNull()
      .references(() => mapPlaces.id, { onDelete: "cascade" }),
    fieldDefinitionId: uuid("field_definition_id")
      .notNull()
      .references(() => fieldDefinitions.id, { onDelete: "cascade" }),
    value: jsonb("value"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.mapPlaceId, t.fieldDefinitionId] })],
);

// ---------------------------------------------------------------------------
// Social layer
// ---------------------------------------------------------------------------

export const photos = pgTable(
  "photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mapPlaceId: uuid("map_place_id")
      .notNull()
      .references(() => mapPlaces.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    thumbPath: text("thumb_path").notNull(),
    caption: text("caption"),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("photos_mp_idx").on(t.mapPlaceId)],
);

export const ratings = pgTable(
  "ratings",
  {
    mapPlaceId: uuid("map_place_id")
      .notNull()
      .references(() => mapPlaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stars: integer("stars").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.mapPlaceId, t.userId] })],
);

export const notes = pgTable(
  "notes",
  {
    mapPlaceId: uuid("map_place_id")
      .notNull()
      .references(() => mapPlaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull().default(""),
    shared: boolean("shared").notNull().default(false),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.mapPlaceId, t.userId] })],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mapPlaceId: uuid("map_place_id")
      .notNull()
      .references(() => mapPlaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("comments_mp_idx").on(t.mapPlaceId)],
);

// ---------------------------------------------------------------------------
// Realtime: persisted per-map sequences ([2026] VJS-CC-WAYMARK 1 D5)
// ---------------------------------------------------------------------------

export const mapEventSeqs = pgTable("map_event_seqs", {
  mapId: uuid("map_id")
    .primaryKey()
    .references(() => maps.id, { onDelete: "cascade" }),
  lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
});

export const activityEvents = pgTable(
  "activity_events",
  {
    mapId: uuid("map_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.mapId, t.seq] })],
);
