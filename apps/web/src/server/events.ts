// Realtime bus. Mutations publish topic events; every open window/terminal receives them over Server-Sent
// Events (/api/events) and refreshes the affected data. In cloud mode with several app instances, set
// PETRA_REALTIME=postgres to fan out through PostgreSQL LISTEN/NOTIFY.
import { EventEmitter } from "node:events";

export type Topic = "rooms" | "reservations" | "folios" | "housekeeping" | "maintenance" | "guests" | "settings" | "businessDate" | "users" | "notes" | "system";

export interface PetraEvent {
  topic: Topic;
  action: string;
  id?: string;
  /** user who caused the change (so the originating window can skip its own echo if it wants) */
  by?: string;
  at: string;
}

const g = globalThis as unknown as { __petraBus?: EventEmitter; __petraPgBridge?: boolean };
g.__petraBus ??= Object.assign(new EventEmitter(), {}).setMaxListeners(1000);
export const bus = g.__petraBus;

export function publish(topic: Topic, action: string, id?: string, by?: string) {
  const ev: PetraEvent = { topic, action, id, by, at: new Date().toISOString() };
  bus.emit("event", ev);
  pgNotify?.(ev);
}

let pgNotify: ((ev: PetraEvent) => void) | null = null;

/** Optional PostgreSQL LISTEN/NOTIFY bridge for multi-instance cloud deployments. */
export async function startPgBridge(url: string) {
  if (g.__petraPgBridge) return;
  g.__petraPgBridge = true;
  const { Client } = await import("pg");
  const instance = Math.random().toString(36).slice(2);
  const listen = new Client({ connectionString: url });
  const send = new Client({ connectionString: url });
  await Promise.all([listen.connect(), send.connect()]);
  await listen.query("LISTEN petra_events");
  listen.on("notification", (n) => {
    try {
      const { from, ev } = JSON.parse(n.payload ?? "{}");
      if (from !== instance) bus.emit("event", ev);
    } catch {
      /* ignore malformed */
    }
  });
  pgNotify = (ev) => void send.query("SELECT pg_notify('petra_events', $1)", [JSON.stringify({ from: instance, ev })]).catch(() => undefined);
}
