import { Button, Input, Select, Option, Textarea } from "../ui/controls.js";
import { useEffect, useMemo, useState } from "react";
import type { MapPlaceDetail } from "@waymark/shared";
import { api } from "../api/client.js";
import { useStore } from "../state/store.js";
import { EditPlaceBox } from "./EditPlaceBox.js";

export function PlaceSummaryCard() {
  const selectedId = useStore((s) => s.selectedId);
  const places = useStore((s) => s.places);
  const current = useStore((s) => s.current);
  const select = useStore((s) => s.select);
  const [detail, setDetail] = useState<MapPlaceDetail | null>(null);
  const [nearby, setNearby] = useState<{ id: string; name: string; dist: number }[]>([]);
  const [editing, setEditing] = useState(false);

  const mp = selectedId ? places.byId[selectedId] : undefined;
  const terms = current?.terms ?? [];

  useEffect(() => {
    setDetail(null);
    setNearby([]);
    setEditing(false);
    if (!selectedId || !current) return;
    api.mapPlace(current.map.id, selectedId).then(setDetail).catch(() => {});
  }, [selectedId, current]);

  if (!mp || !current) return null;
  const canWrite = current.map.yourRole === "owner" || current.map.yourRole === "editor";
  const categoryFacetId = current.facets.find((f) => f.key === "category")?.id;
  const fieldDefs = (useStore.getState() as { fieldDefs?: import("@waymark/shared").FieldDefinitionRecord[] }).fieldDefs ?? [];
  const primary = terms.find((t) => t.id === mp.primaryTermId);
  const others = mp.termIds.filter((t) => t !== mp.primaryTermId).map((id) => terms.find((t) => t.id === id));

  const findNearby = async () => {
    const results = await api.nearby(current.map.id, {
      lat: mp.place.location.lat,
      lng: mp.place.location.lng,
      radius: 5000,
      likeMapPlaceId: mp.id,
    });
    setNearby(
      results.slice(0, 8).map((r) => ({
        id: r.id,
        name: r.place.name,
        dist: Math.hypot(
          (r.place.location.lat - mp.place.location.lat) * 111,
          (r.place.location.lng - mp.place.location.lng) * 69,
        ),
      })),
    );
  };

  return (
    <div className="panel summary-card">
      <Button className="close" onClick={() => select(null)} aria-label="Close">×</Button>
      <h2>{mp.place.name}</h2>
      {primary && (
        <span className="tag" style={{ background: primary.color }}>
          {primary.name}
        </span>
      )}
      {others.filter(Boolean).map((t) => (
        <span key={t!.id} className="tag dim">
          {t!.name}
        </span>
      ))}
      {mp.place.address && <p className="addr">{mp.place.address}</p>}
      <div className="meta">
        {mp.ratingAvg !== null && <span title={`${mp.ratingCount} ratings`}>★ {mp.ratingAvg.toFixed(1)}</span>}
        <span>{mp.photoCount} 📷</span>
        <span>{mp.commentCount} 💬</span>
        <span className="who">by {mp.addedByName}</span>
      </div>
      {mp.sharedNote && <p className="note">{mp.sharedNote}</p>}

      <div className="row">
        <Button onClick={() => api.rate(current.map.id, mp.id, (((detail?.yourRating ?? mp.yourRating) ?? 0) % 5) + 1).then(() => findNearby()).catch(() => {})}>
          {(detail?.yourRating ?? mp.yourRating) ? `★ ${detail?.yourRating ?? mp.yourRating}` : "Rate"}
        </Button>
        <Button onClick={() => void findNearby()}>More like this</Button>
        {canWrite && !editing && <Button onClick={() => setEditing(true)}>Edit</Button>}
      </div>

      {editing && detail && canWrite && (
        <EditPlaceBox
          mapId={current.map.id}
          mp={mp}
          detail={detail}
          terms={terms}
          categoryFacetId={categoryFacetId}
          fieldDefs={fieldDefs}
          onClose={() => setEditing(false)}
        />
      )}

      {nearby.length > 0 && (
        <div className="nearby">
          <h3>Similar nearby</h3>
          {nearby.map((n) => (
            <Button key={n.id} className="nearby-item" onClick={() => select(n.id)}>
              {n.name} <span>{n.dist.toFixed(1)} km</span>
            </Button>
          ))}
        </div>
      )}

      {detail && (
        <div className="detail">
          {Object.entries(detail.fieldValues).length > 0 && (
            <dl className="fields">
              {Object.entries(detail.fieldValues).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          {detail.yourNote && <p className="note private">🔒 {detail.yourNote.body}</p>}
          {detail.sharedNotes.map((n) => (
            <p key={n.userId} className="note shared">👥 {n.body}</p>
          ))}
          <div className="comments">
            {detail.comments.map((c) => (
              <p key={c.id}>
                <strong>{c.userName}</strong> {c.body}
              </p>
            ))}
          </div>
          <CommentBox mapId={current.map.id} mpId={mp.id} />
          <NoteBox mapId={current.map.id} mpId={mp.id} detail={detail} />
          <PhotoBox mapId={current.map.id} mpId={mp.id} />
          {detail.revisions.length > 0 && (
            <p className="revisions">
              v{detail.version} · edited {detail.revisions.length}× · last by {detail.revisions[0]?.changedByName}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CommentBox({ mapId, mpId }: { mapId: string; mpId: string }) {
  const [body, setBody] = useState("");
  const refresh = useStore((s) => s.refreshSelected);
  return (
    <form
      className="row"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) return;
        await api.comment(mapId, mpId, body.trim()).catch(() => {});
        setBody("");
        refresh();
      }}
    >
      <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" />
      <Button>Send</Button>
    </form>
  );
}

function NoteBox({ mapId, mpId, detail }: { mapId: string; mpId: string; detail: MapPlaceDetail }) {
  const [body, setBody] = useState(detail.yourNote?.body ?? "");
  const [shared, setShared] = useState(detail.yourNote?.shared ?? false);
  useEffect(() => {
    setBody(detail.yourNote?.body ?? "");
    setShared(detail.yourNote?.shared ?? false);
  }, [detail]);
  return (
    <form
      className="row note-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await api.saveNote(mapId, mpId, body, shared).catch(() => {});
      }}
    >
      <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Your note (private unless shared)" />
      <label>
        <Input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> share
      </label>
      <Button>Save note</Button>
    </form>
  );
}

function PhotoBox({ mapId, mpId }: { mapId: string; mpId: string }) {
  const refresh = useStore((s) => s.refreshSelected);
  const inputRef = useMemo(() => ({ current: null as HTMLInputElement | null }), []);
  return (
    <div className="row">
      <Input
        ref={(el) => {
          inputRef.current = el;
        }}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          await api.uploadPhoto(mapId, mpId, f).catch(() => {});
          e.target.value = "";
          refresh();
        }}
      />
      <Button onClick={() => inputRef.current?.click()}>Add photo</Button>
    </div>
  );
}
