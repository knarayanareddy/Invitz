import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";

describe("delivery retries, 5-strike auto-disable, DLQ, and Telegram/Discord webhooks", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("retries transient 429 honoring Retry-After and dead-letters + email fallbacks on strike 5", async () => {
    process.env.NOTIFY_DRY_RUN = "false";
    process.env.DISABLE_PG_BOSS = "true";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Invitz <no-reply@invitz.app>";

    const encDest = encryptSecret("https://discord.com/api/webhooks/123/secret");
    const updates: Array<{ table: string; set: Record<string, unknown> }> = [];
    const inserts: Array<{ row: Record<string, unknown> }> = [];
    const fetchCalls: string[] = [];

    const makeMockDb = (attempts: number, failureCount: number, statusCode: number) => ({
      select: (() => {
        let idx = 0;
        const results = [
          // 1. notifications row
          [
            {
              id: "notif-1",
              userId: "user-1",
              inviteId: "inv-1",
              channel: "discord",
              channelId: "ch-1",
              reason: "Shared in ML Engineers",
              status: "pending",
              attempts,
            },
          ],
          // 2. notificationChannels row
          [
            {
              id: "ch-1",
              userId: "user-1",
              type: "discord",
              destination: encDest.ciphertext,
              verified: true,
              verifiedDryRun: false,
              enabled: true,
              includeUnverified: false,
              failureCount,
              disabledReason: null,
            },
          ],
          // 3. invite envelope
          [
            {
              id: "inv-1",
              status: "published",
              verdict: "verified",
              note: "Talks",
              sharerId: "user-sharer",
              sharerHandle: "ada",
              title: "MLOps Meetup",
              startsAt: null,
              location: "Berlin",
              eventUrl: "https://example.com/mlops",
            },
          ],
          // 4. notificationPreferences
          [{ userId: "user-1", timezone: "UTC", dailyCap: 5, digestMode: "instant", emailFallback: true }],
          // 5. dailyCap sentToday count
          [{ sentToday: 0 }],
          // 6. verified email channel lookup in fallback
          [],
          // 7. user email lookup in fallback
          [{ email: "grace@example.com" }],
        ];
        return () => {
          const res = results[idx++] ?? [];
          const q = {
            from: () => q,
            innerJoin: () => q,
            where: () => q,
            limit: () => Promise.resolve(res),
            then: (resolve: (v: unknown) => void) => Promise.resolve(res).then(resolve),
          };
          return q;
        };
      })(),
      update: (table: unknown) => ({
        set: (val: Record<string, unknown>) => {
          updates.push({
            table: String((table as { [key: symbol]: string })?.[Symbol.for("drizzle:Name")] ?? "table"),
            set: val,
          });
          return { where: () => Promise.resolve([]) };
        },
      }),
      insert: () => ({
        values: (val: Record<string, unknown>) => {
          inserts.push({ row: val });
          return {
            onConflictDoNothing: () => ({
              returning: () => Promise.resolve([{ id: "notif-fallback-1", ...val }]),
            }),
          };
        },
      }),
    });

    // Scenario A: 429 transient failure on attempt 0 schedules retry respecting retry-after (90s > 30s backoff)
    vi.doMock("@/db", () => ({ db: makeMockDb(0, 0, 429) }));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ retry_after: 90 }), {
        status: 429,
        headers: { "retry-after": "90" },
      }),
    );

    const modA = await import("@/lib/notify/dispatch");
    const resA = await modA.deliverNotificationNow("notif-1");
    expect(resA.ok).toBe(false);
    expect(resA.status).toBe("pending");
    const retryUpdate = updates.find((u) => u.set.deliveryStatus === "retrying");
    expect(retryUpdate?.set.attempts).toBe(1);
    const retryAt = retryUpdate?.set.nextRetryAt as Date;
    expect(retryAt.getTime() - Date.now()).toBeGreaterThanOrEqual(80_000);

    // Scenario B: 5th permanent 403 strike auto-disables channel, dead-letters, and sends email fallback
    vi.resetModules();
    updates.length = 0;
    inserts.length = 0;
    vi.doMock("@/db", () => ({ db: makeMockDb(4, 4, 403) }));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      fetchCalls.push(String(url));
      if (String(url).includes("discord.com")) {
        return new Response("Forbidden", { status: 403 });
      }
      return new Response(JSON.stringify({ id: "fallback_email_1" }), { status: 200 });
    });

    const modB = await import("@/lib/notify/dispatch");
    const resB = await modB.deliverNotificationNow("notif-1");
    expect(resB.ok).toBe(false);
    expect(resB.status).toBe("dead_letter");
    expect(updates.some((u) => u.set.enabled === false && u.set.failureCount === 5)).toBe(true);
    expect(updates.some((u) => u.set.status === "dead_letter")).toBe(true);
    expect(fetchCalls.some((u) => u.includes("api.resend.com/emails"))).toBe(true);
  });

  it("Telegram webhook links /start <token> with encrypted chat ID and handles /stop", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "tg-hook-secret";
    const updatedPayloads: Array<Record<string, unknown>> = [];

    vi.doMock("@/db", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ id: "ch-tg-1", type: "telegram" }]),
            }),
          }),
        }),
        update: () => ({
          set: (vals: Record<string, unknown>) => {
            updatedPayloads.push(vals);
            return { where: () => Promise.resolve([]) };
          },
        }),
      },
    }));

    const { POST } = await import("@/app/api/webhooks/telegram/route");

    const bad = await POST(
      new Request("http://localhost/api/webhooks/telegram", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "wrong" },
        body: JSON.stringify({}),
      }),
    );
    expect(bad.status).toBe(401);

    const startRes = await POST(
      new Request("http://localhost/api/webhooks/telegram", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "tg-hook-secret" },
        body: JSON.stringify({ message: { text: "/start tok_abc123", chat: { id: 777888999 } } }),
      }),
    );
    expect(startRes.status).toBe(200);
    expect((await startRes.json()) as { linked: boolean }).toEqual({ ok: true, linked: true });
    expect(String(updatedPayloads[0].destination)).toMatch(/^enc:v1:/);
    expect(updatedPayloads[0].verified).toBe(true);

    const stopRes = await POST(
      new Request("http://localhost/api/webhooks/telegram", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "tg-hook-secret" },
        body: JSON.stringify({ message: { text: "/stop", chat: { id: 777888999 } } }),
      }),
    );
    expect(stopRes.status).toBe(200);
    expect(updatedPayloads[1].enabled).toBe(false);
  });

  it("Discord /invitz subscribe rejects non-public groups cleanly", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    process.env.DISCORD_PUBLIC_KEY = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");

    vi.doMock("@/db", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]), // private group is excluded by visibility='public' filter
            }),
          }),
        }),
      },
    }));

    const { POST } = await import("@/app/api/webhooks/discord/route");
    const body = JSON.stringify({
      type: 2,
      guild_id: "g-1",
      channel_id: "c-1",
      member: { permissions: "32" }, // MANAGE_GUILD
      data: {
        name: "invitz",
        options: [{ name: "subscribe", type: 1, options: [{ name: "community", value: "secret-group" }] }],
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign(null, Buffer.from(ts + body, "utf8"), privateKey).toString("hex");

    const res = await POST(
      new Request("http://localhost/api/webhooks/discord", {
        method: "POST",
        headers: { "x-signature-ed25519": sig, "x-signature-timestamp": ts },
        body,
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { data: { content: string } };
    expect(data.data.content).toContain("No public Invitz community found");
  });
});
