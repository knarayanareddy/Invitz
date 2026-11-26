export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.DATABASE_URL) return;
  if (process.env.NOTIFY_USE_EXTERNAL_WORKER === "true") return;

  const g = globalThis as unknown as { __invitzDueSweeper?: boolean };
  if (g.__invitzDueSweeper) return;
  g.__invitzDueSweeper = true;

  const { processDueNotificationsAndDigests } = await import("@/lib/notify/dispatch");

  // Single-instance background sweep for quiet-hours deferrals, retry backoff, and digests.
  const timer = setInterval(() => {
    void processDueNotificationsAndDigests().catch((err) => {
      console.warn("[instrumentation] due notification sweep error:", err instanceof Error ? err.message : err);
    });
  }, 60_000);
  timer.unref();
}
