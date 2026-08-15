import { Button } from "../ui/controls.js";
import { useEffect, useState } from "react";
import { useStore } from "../state/store.js";
import { connectLive, type LiveClient } from "../state/live.js";
import { api } from "../api/client.js";
import { AuthScreen } from "./AuthScreen.js";
import { Dashboard, MembersPanel } from "./Dashboard.js";
import { ManagePanel } from "./ManagePanel.js";
import { MapView } from "./MapView.js";
import { PlaceSummaryCard } from "./PlaceSummaryCard.js";
import { AddPlaceSheet } from "./AddPlaceSheet.js";
import { FiltersBar, loadViewport } from "./FiltersBar.js";
import type { UserPublic } from "@waymark/shared";

export function App() {
  const { user, authChecked, setUser, setAuthChecked, current, openMap, closeMap } = useStore();
  const [picked, setPicked] = useState<{ lng: number; lat: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showManage, setShowManage] = useState(false);
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
        <Button className="link" onClick={closeMap}>
          ← maps
        </Button>
        <strong>{current.map.name}</strong>
        <span className={`live ${liveStatus}`}>{liveStatus}</span>
        <span className="spacer" />
        <Button onClick={() => { setShowMembers(!showMembers); setShowManage(false); }}>Members</Button>
        <Button onClick={() => { setShowManage(!showManage); setShowMembers(false); }}>Manage</Button>
        <Button
          className={adding ? "primary" : ""}
          onClick={() => {
            setAdding(!adding);
            setPicked(null);
          }}
        >
          {adding ? "Cancel" : "+ Add place"}
        </Button>
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
      {showManage && <ManagePanel mapId={current.map.id} onClose={() => setShowManage(false)} />}
    </div>
  );
}

let lastBbox: [number, number, number, number] = [-180, -85, 180, 85];
