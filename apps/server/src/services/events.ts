import { EventEmitter } from "node:events";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Db, DbTx } from "../db/client.js";
import { activityEvents, mapEventSeqs } from "../db/schema.js";
import type { ServerEvent } from "@waymark/shared";

// Persisted per-map monotonic sequences + post-commit broadcast
// ([2026] VJS-CC-WAYMARK 1 D5): events are persisted transactionally
// BEFORE any socket sees them; the DB is the source of truth.

export interface RecordedEvent {
  seq: number;
  at: string;
}

export interface EventPublisher {
  /** Allocate the next seq and persist the event row — INSIDE the caller's transaction. */
  record: (
    tx: DbTx,
    mapId: string,
    type: ServerEvent["type"],
    payload: unknown,
  ) => Promise<RecordedEvent>;
  /** Broadcast an already-persisted event — AFTER the transaction commits. */
  publish: (mapId: string, e: RecordedEvent, type: ServerEvent["type"], payload: unknown) => void;
  /** Replay missed events from the DB (resync). */
  replay: (mapId: string, sinceSeq: number, limit?: number) => Promise<ServerEvent[]>;
  latestSeq: (mapId: string) => Promise<number>;
  subscribe: (mapId: string, fn: (e: ServerEvent) => void) => () => void;
}

export function makeEventBus(db: Db): EventPublisher {
  const bus = new EventEmitter();
  bus.setMaxListeners(1000);

  const record: EventPublisher["record"] = async (tx, mapId, type, payload) => {
    const res = (await tx.execute(
      sql`INSERT INTO map_event_seqs (map_id, last_seq)
          VALUES (${mapId}, 1)
          ON CONFLICT (map_id) DO UPDATE SET last_seq = map_event_seqs.last_seq + 1
          RETURNING last_seq`,
    )) as unknown as { rows?: { last_seq: string | number }[] } | { last_seq: string | number }[];
    const rows = Array.isArray(res) ? res : (res.rows ?? []);
    const seq = Number(rows[0]?.last_seq ?? 1);
    const [eventRow] = await tx
      .insert(activityEvents)
      .values({ mapId, seq, type, payload: payload as object })
      .returning({ at: activityEvents.at });
    return { seq, at: eventRow?.at ?? new Date().toISOString() };
  };

  const publish: EventPublisher["publish"] = (mapId, e, type, payload) => {
    const event = { seq: e.seq, mapId, type, payload, at: e.at } as ServerEvent;
    bus.emit(`map:${mapId}`, event);
  };

  const replay: EventPublisher["replay"] = async (mapId, sinceSeq, limit = 500) => {
    const rows = await db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.mapId, mapId), gt(activityEvents.seq, sinceSeq)))
      .orderBy(activityEvents.seq)
      .limit(limit);
    return rows.map((r) => ({
      seq: r.seq,
      mapId: r.mapId,
      type: r.type,
      payload: r.payload,
      at: r.at,
    })) as ServerEvent[];
  };

  const latestSeq: EventPublisher["latestSeq"] = async (mapId) => {
    const [row] = await db
      .select({ lastSeq: mapEventSeqs.lastSeq })
      .from(mapEventSeqs)
      .where(eq(mapEventSeqs.mapId, mapId));
    return row?.lastSeq ?? 0;
  };

  const subscribe: EventPublisher["subscribe"] = (mapId, fn) => {
    const channel = `map:${mapId}`;
    bus.on(channel, fn);
    return () => bus.off(channel, fn);
  };

  return { record, publish, replay, latestSeq, subscribe };
}
