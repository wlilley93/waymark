import type {
  MapPlaceSummary,
  MapPlaceDetail,
  MapSummary,
  InviteRecord,
  MemberRecord,
  FacetRecord,
  TermRecord,
  FieldDefinitionRecord,
  CreatePlaceInput,
} from "@waymark/shared";

const BASE = "/api";

async function call<T>(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; raw?: Response } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  if (opts.raw) return res as unknown as T;
  if (!res.ok) {
    const err = new Error(`API ${res.status}`) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    try {
      err.body = await res.json();
    } catch {
      /* ignore */
    }
    throw err;
  }
  return (res.status === 204 ? undefined : res.json()) as Promise<T>;
}

export interface MapDetailBundle {
  map: MapSummary;
  facets: FacetRecord[];
  terms: TermRecord[];
}

export const api = {
  // auth
  signup: (body: { email: string; password: string; name: string }) => call<{ id: string }>("POST", "/auth/signup", { body }),
  login: (body: { email: string; password: string }) => call<{ id: string }>("POST", "/auth/login", { body }),
  logout: () => call<{ ok: boolean }>("POST", "/auth/logout"),
  me: () => call<{ id: string; email: string; name: string }>("GET", "/auth/me"),

  // maps
  listMaps: () => call<MapSummary[]>("GET", "/maps"),
  createMap: (body: { name: string; description?: string }) => call<MapSummary>("POST", "/maps", { body }),
  getMap: (id: string) => call<MapDetailBundle>("GET", `/maps/${id}`),
  members: (mapId: string) => call<MemberRecord[]>("GET", `/maps/${mapId}/members`),
  setMemberRole: (mapId: string, userId: string, role: string) => call<{ ok: boolean }>("PATCH", `/maps/${mapId}/members/${userId}`, { body: { role } }),
  removeMember: (mapId: string, userId: string) => call<{ ok: boolean }>("DELETE", `/maps/${mapId}/members/${userId}`),
  createInvite: (mapId: string, body: { role: "editor" | "viewer"; maxUses?: number | null; ttlHours?: number }) => call<InviteRecord>("POST", `/maps/${mapId}/invites`, { body }),
  listInvites: (mapId: string) => call<InviteRecord[]>("GET", `/maps/${mapId}/invites`),
  revokeInvite: (mapId: string, inviteId: string) => call<{ ok: boolean }>("DELETE", `/maps/${mapId}/invites/${inviteId}`),
  acceptInvite: (token: string) => call<{ mapId: string; mapName: string }>("POST", `/invites/${token}/accept`, { body: {} }),

  // taxonomy + fields
  facets: (mapId: string) => call<{ facets: FacetRecord[]; terms: TermRecord[] }>("GET", `/maps/${mapId}/facets`),
  addTerm: (mapId: string, body: { facetId: string; name: string; color?: string }) => call<TermRecord>("POST", `/maps/${mapId}/terms`, { body }),
  addFacet: (mapId: string, body: { key: string; name: string }) => call<FacetRecord>("POST", `/maps/${mapId}/facets`, { body }),
  fields: (mapId: string) => call<FieldDefinitionRecord[]>("GET", `/maps/${mapId}/fields`),
  addField: (mapId: string, body: Record<string, unknown>) => call<FieldDefinitionRecord>("POST", `/maps/${mapId}/fields`, { body }),

  // places
  geocode: (q: string) => call<{ provider: string; results: { name: string; lat: number; lng: number; address?: string; website?: string; osm?: { type: string; id: number } }[] }>("GET", `/geocode?q=${encodeURIComponent(q)}`),
  createPlace: (body: CreatePlaceInput) => call<{ id: string }>("POST", "/places", { body }),

  // map places
  viewport: (mapId: string, bbox: string, params: { termIds?: string[]; minRating?: number; mine?: boolean } = {}) => {
    const q = new URLSearchParams({ bbox });
    if (params.termIds?.length) q.set("termIds", params.termIds.join(","));
    if (params.minRating) q.set("minRating", String(params.minRating));
    if (params.mine) q.set("mine", "true");
    return call<MapPlaceSummary[]>("GET", `/maps/${mapId}/map-places?${q}`);
  },
  nearby: (mapId: string, params: { lat: number; lng: number; radius?: number; termId?: string; likeMapPlaceId?: string }) => {
    const q = new URLSearchParams({ lat: String(params.lat), lng: String(params.lng), radius: String(params.radius ?? 2000) });
    if (params.termId) q.set("termId", params.termId);
    if (params.likeMapPlaceId) q.set("likeMapPlaceId", params.likeMapPlaceId);
    return call<MapPlaceSummary[]>("GET", `/maps/${mapId}/map-places/nearby?${q}`);
  },
  mapPlace: (mapId: string, mpId: string) => call<MapPlaceDetail>("GET", `/maps/${mapId}/map-places/${mpId}`),
  createMapPlace: (mapId: string, body: Record<string, unknown>) => call<MapPlaceSummary>("POST", `/maps/${mapId}/map-places`, { body }),
  patchMapPlace: (mapId: string, mpId: string, version: number, body: Record<string, unknown>) =>
    call<MapPlaceSummary | { error: string; currentVersion: number; current: MapPlaceSummary }>("PATCH", `/maps/${mapId}/map-places/${mpId}`, {
      body,
      headers: { "if-match": String(version) },
    }) as Promise<MapPlaceSummary>,
  deleteMapPlace: (mapId: string, mpId: string, version: number) =>
    call<{ ok: boolean }>("DELETE", `/maps/${mapId}/map-places/${mpId}`, { headers: { "if-match": String(version) } }),
  rate: (mapId: string, mpId: string, stars: number) => call<{ ok: boolean }>("POST", `/maps/${mapId}/map-places/${mpId}/rating`, { body: { stars } }),
  saveNote: (mapId: string, mpId: string, body: string, shared: boolean) => call<{ ok: boolean }>("PUT", `/maps/${mapId}/map-places/${mpId}/note`, { body: { body, shared } }),
  comment: (mapId: string, mpId: string, body: string) => call<{ id: string }>("POST", `/maps/${mapId}/map-places/${mpId}/comments`, { body: { body } }),
  uploadPhoto: (mapId: string, mpId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${BASE}/maps/${mapId}/map-places/${mpId}/photos`, { method: "POST", body: form, credentials: "same-origin" }).then(async (r) => {
      if (!r.ok) throw new Error(`upload ${r.status}`);
      return r.json();
    });
  },
};
