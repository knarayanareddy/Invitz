import {
  deliverGuildDiscordSubscription,
  deliverNotificationNow,
  fanOutInvite,
  processDueNotificationsAndDigests,
  sendDigestBatch,
} from "@/lib/notify/dispatch";
import { getBoss, QUEUE_NAMES, stopBoss } from "@/lib/notify/queue";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[worker] DATABASE_URL is required");
    process.exit(1);
  }

  const boss = await getBoss();
  if (!boss) {
    console.error("[worker] Failed to initialize pg-boss queue");
    process.exit(1);
  }

  await boss.work<{ inviteId: string }>(QUEUE_NAMES.FANOUT, { batchSize: 5 }, async (jobs) => {
    for (const job of jobs) {
      if (job.data?.inviteId) {
        await fanOutInvite(job.data.inviteId);
      }
    }
  });

  await boss.work<{ notificationId: string }>(QUEUE_NAMES.DELIVER, { batchSize: 10 }, async (jobs) => {
    for (const job of jobs) {
      if (job.data?.notificationId) {
        await deliverNotificationNow(job.data.notificationId);
      }
    }
  });

  await boss.work<{ userId: string; channelId: string }>(QUEUE_NAMES.DIGEST, { batchSize: 5 }, async (jobs) => {
    for (const job of jobs) {
      if (job.data?.userId && job.data?.channelId) {
        await sendDigestBatch(job.data.userId, job.data.channelId);
      }
    }
  });

  await boss.work<{ inviteId: string; subscriptionId: string }>(
    QUEUE_NAMES.GUILD_DISCORD,
    { batchSize: 5 },
    async (jobs) => {
      for (const job of jobs) {
        if (job.data?.inviteId && job.data?.subscriptionId) {
          await deliverGuildDiscordSubscription(job.data.inviteId, job.data.subscriptionId);
        }
      }
    },
  );

  // Periodic sweep every 60s for digest buckets & scheduled retries
  const interval = setInterval(() => {
    void processDueNotificationsAndDigests().catch((err) => {
      console.error("[worker] sweep error:", err);
    });
  }, 60_000);

  console.log("[worker] Invitz pg-boss notification worker started");

  const shutdown = async (sig: string) => {
    console.log(`[worker] Received ${sig}, shutting down gracefully...`);
    clearInterval(interval);
    await stopBoss();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
