import { PgBoss } from "pg-boss";

export const QUEUE_NAMES = {
  FANOUT: "notify.fanout",
  DELIVER: "notify.deliver",
  DELIVER_DLQ: "notify.deliver.dlq",
  DIGEST: "notify.digest",
  GUILD_DISCORD: "notify.guild_discord",
} as const;

type QueueState = {
  boss: PgBoss | null;
  initPromise: Promise<PgBoss | null> | null;
};

const globalQueue = globalThis as unknown as { __invitzBoss?: QueueState };

function getQueueState(): QueueState {
  if (!globalQueue.__invitzBoss) {
    globalQueue.__invitzBoss = { boss: null, initPromise: null };
  }
  return globalQueue.__invitzBoss;
}

export function isPgliteUrl(url: string | undefined): boolean {
  if (!url) return false;
  return url.includes("/tmp/preview-db") || url.includes("pglite");
}

export async function getBoss(): Promise<PgBoss | null> {
  if (process.env.DISABLE_PG_BOSS === "true") return null;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  const state = getQueueState();
  if (state.boss) return state.boss;
  if (state.initPromise) return state.initPromise;

  state.initPromise = (async () => {
    const pglite = isPgliteUrl(connectionString);
    const boss = new PgBoss({
      connectionString,
      backend: pglite ? "pglite" : "postgres",
      max: pglite ? 1 : 5,
      supervise: !pglite,
      schedule: !pglite,
      migrate: true,
    });

    boss.on("error", (err) => {
      console.error("[pg-boss] error:", err);
    });

    await boss.start();

    // Ensure dead-letter queue exists before main queues that reference it.
    await boss.createQueue(QUEUE_NAMES.DELIVER_DLQ).catch(() => undefined);
    await boss.createQueue(QUEUE_NAMES.FANOUT).catch(() => undefined);
    await boss
      .createQueue(QUEUE_NAMES.DELIVER, {
        deadLetter: QUEUE_NAMES.DELIVER_DLQ,
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
      })
      .catch(() => undefined);
    await boss
      .createQueue(QUEUE_NAMES.DIGEST, {
        retryLimit: 3,
        retryDelay: 60,
        retryBackoff: true,
      })
      .catch(() => undefined);
    await boss
      .createQueue(QUEUE_NAMES.GUILD_DISCORD, {
        retryLimit: 4,
        retryDelay: 30,
        retryBackoff: true,
      })
      .catch(() => undefined);

    state.boss = boss;
    return boss;
  })().catch((err) => {
    console.warn("[pg-boss] failed to start, using direct async dispatch:", err instanceof Error ? err.message : err);
    state.initPromise = null;
    state.boss = null;
    return null;
  });

  return state.initPromise;
}

export async function enqueueFanout(inviteId: string): Promise<string | null> {
  const boss = await getBoss();
  if (!boss) return null;
  return boss.send(
    QUEUE_NAMES.FANOUT,
    { inviteId },
    { singletonKey: `fanout:${inviteId}` },
  );
}

export async function enqueueDelivery(notificationId: string, startAfter?: Date): Promise<string | null> {
  const boss = await getBoss();
  if (!boss) return null;
  const shouldDefer = startAfter && startAfter.getTime() > Date.now() + 1000;
  return boss.send(
    QUEUE_NAMES.DELIVER,
    { notificationId },
    {
      singletonKey: `deliver:${notificationId}:${Math.floor((startAfter?.getTime() ?? Date.now()) / 1000)}`,
      ...(shouldDefer ? { startAfter } : {}),
    },
  );
}

export async function enqueueDigest(userId: string, channelId: string, startAfter?: Date): Promise<string | null> {
  const boss = await getBoss();
  if (!boss) return null;
  const bucketKey = Math.floor((startAfter?.getTime() ?? Date.now()) / 60_000);
  const shouldDefer = startAfter && startAfter.getTime() > Date.now() + 1000;
  return boss.send(
    QUEUE_NAMES.DIGEST,
    { userId, channelId },
    {
      singletonKey: `digest:${userId}:${channelId}:${bucketKey}`,
      ...(shouldDefer ? { startAfter } : {}),
    },
  );
}

export async function enqueueGuildDiscord(inviteId: string, subscriptionId: string): Promise<string | null> {
  const boss = await getBoss();
  if (!boss) return null;
  return boss.send(
    QUEUE_NAMES.GUILD_DISCORD,
    { inviteId, subscriptionId },
    { singletonKey: `guild:${inviteId}:${subscriptionId}` },
  );
}

export async function stopBoss(): Promise<void> {
  const state = getQueueState();
  if (state.boss) {
    await state.boss.stop({ graceful: true, timeout: 10_000 }).catch(() => undefined);
    state.boss = null;
    state.initPromise = null;
  }
}
