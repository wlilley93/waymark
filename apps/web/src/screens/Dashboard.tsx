import { Button, Input, Select, Textarea, Option } from "../ui/controls.js";
import { useEffect, useState } from "react";
import type { InviteRecord, MemberRecord } from "@waymark/shared";
import { api } from "../api/client.js";
import { useStore } from "../state/store.js";

export function Dashboard({ onOpenMap }: { onOpenMap: (mapId: string) => void }) {
  const { maps, loadMaps, user, closeMap } = useStore();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [joinToken, setJoinToken] = useState("");

  useEffect(() => {
    void loadMaps();
  }, [loadMaps]);

  useEffect(() => {
    // invite deep link: #/join/<token>
    const m = location.hash.match(/^#\/join\/([A-Za-z0-9_-]+)/);
    if (m) {
      setJoinToken(m[1]!);
      history.replaceState(null, "", "#/");
    }
  }, []);

  useEffect(() => {
    if (!joinToken) return;
    api
      .acceptInvite(joinToken)
      .then((r) => {
        setJoinToken("");
        void loadMaps().then(() => onOpenMap(r.mapId));
      })
      .catch(() => {
        setJoinToken("");
        setError("invite invalid or expired");
      });
  }, [joinToken, loadMaps, onOpenMap]);

  return (
    <div className="dashboard">
      <header>
        <h1>Waymark</h1>
        <span className="who">{user?.name}</span>
        <Button
          onClick={() =>
            api.logout().then(() => {
              closeMap();
              useStore.getState().setUser(null);
            })
          }
        >
          Log out
        </Button>
      </header>

      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          try {
            const created = await api.createMap({ name: name.trim() });
            setName("");
            await loadMaps();
            onOpenMap(created.id);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New map name — e.g. Leeds favourites" />
        <Button className="primary">Create map</Button>
      </form>

      {error && <p className="error">{error}</p>}

      <ul className="map-list">
        {maps.map((m) => (
          <li key={m.id}>
            <Button onClick={() => onOpenMap(m.id)}>
              <strong>{m.name}</strong>
              <span>
                {m.placeCount} places · {m.memberCount} members · {m.yourRole}
              </span>
            </Button>
          </li>
        ))}
      </ul>
      <p className="hint">Paste an invite link to join a friend's map — it opens automatically.</p>
    </div>
  );
}

export function MembersPanel({ mapId, onClose }: { mapId: string; onClose: () => void }) {
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const current = useStore((s) => s.current);
  const isOwner = current?.map.yourRole === "owner";

  const load = () => {
    api.members(mapId).then(setMembers).catch(() => {});
    if (isOwner) api.listInvites(mapId).then(setInvites).catch(() => {});
  };
  useEffect(load, [mapId, isOwner]);

  return (
    <div className="panel members">
      <Button className="close" onClick={onClose} aria-label="Close">×</Button>
      <h2>Members</h2>
      <ul>
        {members.map((m) => (
          <li key={m.userId}>
            {m.name} <span className="who">({m.email})</span>
            {isOwner && m.role !== "owner" && (
              <>
                <Select
                  value={m.role}
                  onChange={(e) => api.setMemberRole(mapId, m.userId, e.target.value).then(load).catch(() => {})}
                >
                  <Option value="editor">editor</Option>
                  <Option value="viewer">viewer</Option>
                </Select>
                <Button className="link" onClick={() => api.removeMember(mapId, m.userId).then(load).catch(() => {})}>
                  remove
                </Button>
              </>
            )}
            {m.role === "owner" && <span className="tag dim">owner</span>}
          </li>
        ))}
      </ul>
      {isOwner && (
        <>
          <h3>Invite links</h3>
          <div className="row">
            <Select value={role} onChange={(e) => setRole(e.target.value as "editor" | "viewer")}>
              <Option value="editor">editor</Option>
              <Option value="viewer">viewer</Option>
            </Select>
            <Button
              onClick={() =>
                api
                  .createInvite(mapId, { role, ttlHours: 48 })
                  .then(load)
                  .catch(() => {})
              }
            >
              Create invite
            </Button>
          </div>
          <ul>
            {invites
              .filter((i) => !i.revokedAt)
              .map((i) => (
                <li key={i.id}>
                  <Button className="link" onClick={() => i.url && navigator.clipboard?.writeText(i.url)}>
                    copy link ({i.role}, {i.maxUses ?? "∞"} uses, used {i.uses})
                  </Button>
                  <Button className="link" onClick={() => api.revokeInvite(mapId, i.id).then(load).catch(() => {})}>
                    revoke
                  </Button>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}
