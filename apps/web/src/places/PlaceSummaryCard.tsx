import { useEffect, useMemo, useState } from "react";
import type { MapPlaceDetail } from "@waymark/shared";
import { api } from "../api/client.js";
import { useStore } from "../state/store.js";

export function PlaceSummaryCard() {
  const selectedId = useStore((s) => s.selectedId);
  const places = useStore((s) => s.places);
  const current = useStore((s) => s.current);
  const select = useStore((s) => s.select);
  const [detail, setDetail] = useState<MapPlaceDetail | null>(null);
  const [nearby, setNearby] = useState<{ id: string; name: string; dist: number }[]>([]);

  const mp = selectedId ? places.byId[selectedId] : undefined;
  const terms = current?.terms ?? [];

  useEffect(() => {
    setDetail(null);
    setNearby([]);
    if (!selectedId || !current) return;
    api.mapPlace(current.map.id, selectedId).then(setDetail).catch(() => {});
  }, [selectedId, current]);

  if (!mp || !current) return null;
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
      <button className="close" onClick={() => select(null)} aria-label="Close">×</button>
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
        <button onClick={() => api.rate(current.map.id, mp.id, (((detail?.yourRating ?? mp.yourRating) ?? 0) % 5) + 1).then(() => findNearby()).catch(() => {})}>
          {(detail?.yourRating ?? mp.yourRating) ? `★ ${detail?.yourRating ?? mp.yourRating}` : "Rate"}
        </button>
        <button onClick={() => void findNearby()}>More like this</button>
      </div>

      {nearby.length > 0 && (
        <div className="nearby">
          <h3>Similar nearby</h3>
          {nearby.map((n) => (
            <button key={n.id} className="nearby-item" onClick={() => select(n.id)}>
              {n.name} <span>{n.dist.toFixed(1)} km</span>
            </button>
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
      <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" />
      <button>Send</button>
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
      <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Your note (private unless shared)" />
      <label>
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> share
      </label>
      <button>Save note</button>
    </form>
  );
}

function PhotoBox({ mapId, mpId }: { mapId: string; mpId: string }) {
  const refresh = useStore((s) => s.refreshSelected);
  const inputRef = useMemo(() => ({ current: null as HTMLInputElement | null }), []);
  return (
    <div className="row">
      <input
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
      <button onClick={() => inputRef.current?.click()}>Add photo</button>
    </div>
  );
}
