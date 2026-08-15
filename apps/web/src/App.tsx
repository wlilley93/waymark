import { useEffect, useState } from "react";
import { useStore } from "./state/store.js";
import { connectLive, type LiveClient } from "./state/live.js";
import { api } from "./api/client.js";
import { AuthScreen } from "./auth/AuthScreen.js";
import { Dashboard, MembersPanel } from "./maps/Dashboard.js";
import { MapView } from "./map/MapView.js";
import { PlaceSummaryCard } from "./places/PlaceSummaryCard.js";
import { AddPlaceSheet } from "./places/AddPlaceSheet.js";
import { FiltersBar, loadViewport } from "./filters/FiltersBar.js";
import type { UserPublic } from "@waymark/shared";

export function App() {
  const { user, authChecked, setUser, setAuthChecked, current, openMap, closeMap } = useStore();
  const [picked, setPicked] = useState<{ lng: number; lat: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [liveStatus, setLiveStatus] = useState<"connecting" | "live" | "offline">("offline");
  const applyServerEvent = useStore((s) => s.applyServerEvent);
  const refreshSelected = useStore((s) => s.refreshSelected);
  const filters = useStore((s) => s.filters);

  useEffect(() => {
    api
      .me()
      .then((me) => setUser(me as UserPublic))
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, [setUser, setAuthChecked]);

  // per-map live socket
  useEffect(() => {
    if (!current) return;
    const client: LiveClient = connectLive(
      current.map.id,
      (e) => {
        applyServerEvent(e);
        if (e.type === "place.updated" || e.type === "comment.added") refreshSelected();
      },
      setLiveStatus,
    );
    return () => client.close();
  }, [current, applyServerEvent, refreshSelected]);

  // refetch viewport when filters change
  useEffect(() => {
    if (!current) return;
    void loadViewport(current.map.id, lastBbox);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, current?.map.id]);

  if (!authChecked) return <div className="loading">…</div>;
  if (!user) return <AuthScreen />;
  if (!current) return <Dashboard onOpenMap={(id) => void openMap(id)} />;

  return (
    <div className="app">
      <header className="topbar">
        <button className="link" onClick={closeMap}>
          ← maps
        </button>
        <strong>{current.map.name}</strong>
        <span className={`live ${liveStatus}`}>{liveStatus}</span>
        <span className="spacer" />
        <button onClick={() => setShowMembers(!showMembers)}>Members</button>
        <button
          className={adding ? "primary" : ""}
          onClick={() => {
            setAdding(!adding);
            setPicked(null);
          }}
        >
          {adding ? "Cancel" : "+ Add place"}
        </button>
      </header>

      <MapView
        pickMode={adding}
        onPick={(lng, lat) => setPicked({ lng, lat })}
        onViewport={(bbox) => {
          lastBbox = bbox;
          void loadViewport(current.map.id, bbox);
        }}
      />

      <FiltersBar />
      <PlaceSummaryCard />
      {adding && (
        <AddPlaceSheet
          picked={picked}
          onClose={() => {
            setAdding(false);
            setPicked(null);
          }}
        />
      )}
      {showMembers && <MembersPanel mapId={current.map.id} onClose={() => setShowMembers(false)} />}
    </div>
  );
}

let lastBbox: [number, number, number, number] = [-180, -85, 180, 85];
