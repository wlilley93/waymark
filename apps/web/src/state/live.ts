// Realtime client ([2026] VJS-CC-WAYMARK 1 D5): connects per map, tracks the
// last seen seq, and on ANY reconnect replays from that seq via `resync`.
// Handlers stay idempotent (see reducer); the DB is the source of truth.

import type { ServerEvent } from "@waymark/shared";

export interface LiveClient {
  close: () => void;
}

export function connectLive(
  mapId: string,
  onEvent: (e: ServerEvent) => void,
  onStatus: (s: "connecting" | "live" | "offline") => void,
): LiveClient {
  let ws: WebSocket | null = null;
  let lastSeq = 0;
  let closed = false;
  let backoff = 500;

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/api/maps/${mapId}/ws`;

  const open = () => {
    if (closed) return;
    onStatus("connecting");
    ws = new WebSocket(url);
    ws.onopen = () => {
      backoff = 500;
      ws?.send(JSON.stringify({ type: "resync", sinceSeq: lastSeq }));
      onStatus("live");
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === "hello") {
          if (msg.latestSeq > lastSeq) {
            // we missed events while disconnected and have no seq at all
            ws?.send(JSON.stringify({ type: "resync", sinceSeq: lastSeq }));
          }
          return;
        }
        if (msg.seq !== undefined) {
          if (msg.seq <= lastSeq) return; // duplicate (idempotent safety net)
          lastSeq = msg.seq;
        }
        onEvent(msg as ServerEvent);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (closed) return;
      onStatus("offline");
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 10000);
    };
    ws.onerror = () => ws?.close();
  };

  open();
  // browsers pause sockets in background tabs; visibilitychange forces a
  // freshness check when returning
  const onVisible = () => {
    if (document.visibilityState === "visible" && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resync", sinceSeq: lastSeq }));
    }
  };
  document.addEventListener("visibilitychange", onVisible);

  return {
    close: () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      ws?.close();
    },
  };
}
