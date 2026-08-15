import type { FastifyInstance } from "fastify";
import { clientMessage, type ClientMessage, type ServerEvent } from "@waymark/shared";
import type { Db } from "../db/client.js";
import { requireMembership } from "../services/places.js";
import type { EventPublisher } from "../services/events.js";

// Realtime channel ([2026] VJS-CC-WAYMARK 1 D5): cookie-authenticated per-map
// socket. Client sends {type:'resync',sinceSeq:N} on (re)connect; the server
// replays persisted activity_events then streams live, de-duplicated by a
// per-socket lastSentSeq. Idempotent by construction: consumers upsert by id.

export function buildWsRoutes(db: Db, events: EventPublisher) {
  return async function wsRoutes(app: FastifyInstance) {
    app.get("/api/maps/:mapId/ws", { websocket: true }, (socket, req) => {
      const { mapId } = req.params as { mapId: string };
      let lastSentSeq = 0;
      let closed = false;
      let unsubscribe: (() => void) | null = null;

      void (async () => {
        if (!req.userId) {
          socket.send(JSON.stringify({ type: "error", code: "unauthorized" }), () => socket.close());
          return;
        }
        const member = await requireMembership(db, mapId, req.userId);
        if (!member) {
          socket.send(JSON.stringify({ type: "error", code: "not_a_member" }), () => socket.close());
          return;
        }

        const latest = await events.latestSeq(mapId);
        lastSentSeq = latest;
        socket.send(JSON.stringify({ type: "hello", latestSeq: latest }));

        const send = (e: ServerEvent) => {
          if (closed) return;
          if (e.seq <= lastSentSeq) return; // de-dupe replay/live boundary
          lastSentSeq = e.seq;
          socket.send(JSON.stringify(e));
        };

        // resync semantics: send EVERYTHING > sinceSeq, bypassing the live
        // dedupe — the client asked for it explicitly and upserts idempotently
        const sendForced = (e: ServerEvent) => {
          if (closed) return;
          if (e.seq > lastSentSeq) lastSentSeq = e.seq;
          socket.send(JSON.stringify(e));
        };

        unsubscribe = events.subscribe(mapId, send);

        socket.on("message", async (raw: Buffer) => {
          let msg: ClientMessage;
          try {
            msg = clientMessage.parse(JSON.parse(raw.toString()));
          } catch {
            socket.send(JSON.stringify({ type: "error", code: "bad_message" }));
            return;
          }
          if (msg.type === "ping") {
            socket.send(JSON.stringify({ type: "pong" }));
            return;
          }
          if (msg.type === "resync") {
            const missed = await events.replay(mapId, msg.sinceSeq);
            for (const e of missed) sendForced(e);
          }
        });

        socket.on("close", () => {
          closed = true;
          unsubscribe?.();
        });
      })();
    });
  };
}
