import { EventEmitter } from "node:events";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type BellEventPayload = {
  userId: string;
  notificationId?: string;
  unreadCount?: number;
  kind?: "new" | "read" | "digest";
  at: string;
};

type BusState = {
  emitter: EventEmitter;
  pgListenStarted: boolean;
  pgListenClient: { end: () => Promise<void> } | null;
};

const globalBus = globalThis as unknown as { __invitzBellBus?: BusState };

function getBus(): BusState {
  if (!globalBus.__invitzBellBus) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(1000);
    globalBus.__invitzBellBus = {
      emitter,
      pgListenStarted: false,
      pgListenClient: null,
    };
  }
  return globalBus.__invitzBellBus;
}

function shouldEnablePgListen(): boolean {
  if (process.env.ENABLE_PG_LISTEN === "false") return false;
  if (process.env.ENABLE_PG_LISTEN === "true") return Boolean(process.env.DATABASE_URL);
  // PGlite socket servers live under /tmp/preview-db and only support one active client;
  // enable Postgres LISTEN automatically when using a remote/TCP PostgreSQL server in production.
  const url = process.env.DATABASE_URL ?? "";
  if (!url) return false;
  if (url.includes("/tmp/preview-db") || url.includes("pglite")) return false;
  return process.env.NODE_ENV === "production";
}

export async function ensurePgBellListener(): Promise<void> {
  const bus = getBus();
  if (bus.pgListenStarted || !shouldEnablePgListen()) return;
  bus.pgListenStarted = true;

  try {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.on("error", (err) => {
      console.warn("[realtime] PG LISTEN error, falling back to in-process bus:", err.message);
      bus.pgListenStarted = false;
      bus.pgListenClient = null;
    });
    client.on("notification", (msg) => {
      if (msg.channel !== "invitz_bell" || !msg.payload) return;
      try {
        const parsed = JSON.parse(msg.payload) as BellEventPayload;
        if (parsed?.userId) {
          bus.emitter.emit(`user:${parsed.userId}`, parsed);
        }
      } catch {
        // Ignore malformed payloads
      }
    });
    await client.connect();
    await client.query("LISTEN invitz_bell");
    bus.pgListenClient = client;
  } catch (err) {
    console.warn("[realtime] Unable to start PG LISTEN:", err instanceof Error ? err.message : String(err));
    bus.pgListenStarted = false;
    bus.pgListenClient = null;
  }
}

export async function publishBellUpdate(payload: BellEventPayload): Promise<void> {
  const bus = getBus();
  // Always dispatch immediately in-process so single-instance / PGlite SSE streams update instantaneously.
  bus.emitter.emit(`user:${payload.userId}`, payload);

  // Also broadcast via PostgreSQL NOTIFY for multi-replica deployments when DB is available.
  if (process.env.DATABASE_URL && shouldEnablePgListen()) {
    try {
      await db.execute(sql`SELECT pg_notify('invitz_bell', ${JSON.stringify(payload)})`);
    } catch {
      // Non-fatal; in-process emitter already notified local SSE clients.
    }
  }
}

export function subscribeUserBell(userId: string, handler: (payload: BellEventPayload) => void): () => void {
  const bus = getBus();
  const channel = `user:${userId}`;
  bus.emitter.on(channel, handler);
  void ensurePgBellListener();
  return () => {
    bus.emitter.off(channel, handler);
  };
}
