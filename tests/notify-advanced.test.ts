import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSignalThrottleForTest, getAdapter } from "@/lib/notify/adapters";

describe("Phase 4/6/9 channel adapter contracts", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    clearSignalThrottleForTest();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("Discord v2 sends colored embeds with allowed_mentions=[] and parses 404/429", async () => {
    process.env.NOTIFY_DRY_RUN = "false";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Unknown Webhook", code: 10015 }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ retry_after: 12.5 }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "12" },
        }),
      );

    const discord = getAdapter("discord")!;
    const ok = await discord.send("https://discord.com/api/webhooks/123/abc", {
      kind: "invite",
      title: "✅ Berlin MLOps",
      text: "Great talks",
      url: "https://invitz.app/invites/1",
      caution: false,
      eventWhen: "Tomorrow 18:00",
      eventLocation: "Berlin",
      sharerHandle: "ada",
      reason: "Shared in ML Engineers",
    });
    expect(ok.ok).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      allowed_mentions: { parse: string[] };
      embeds: Array<{ color: number; fields: Array<{ name: string }> }>;
    };
    expect(body.allowed_mentions.parse).toEqual([]);
    expect(body.embeds[0].color).toBe(0x2f6b4f);
    expect(body.embeds[0].fields.some((f) => f.name === "When")).toBe(true);

    const notFound = await discord.send("https://discord.com/api/webhooks/123/abc", {
      title: "Test",
      text: "Body",
      url: "https://invitz.app",
    });
    expect(notFound.ok).toBe(false);
    expect(notFound.statusCode).toBe(404);
    expect(notFound.permanentFailure).toBe(true);

    const rateLimited = await discord.send("https://discord.com/api/webhooks/123/abc", {
      title: "Test",
      text: "Body",
      url: "https://invitz.app",
    });
    expect(rateLimited.ok).toBe(false);
    expect(rateLimited.rateLimited).toBe(true);
    expect(rateLimited.retryAfterMs).toBeGreaterThanOrEqual(12_000);
  });

  it("WhatsApp maps template kinds, parses wamid, and flags invalid recipients", async () => {
    process.env.NOTIFY_DRY_RUN = "false";
    process.env.WHATSAPP_TOKEN = "wa-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "999999";
    process.env.WHATSAPP_TEMPLATE_MAP = JSON.stringify({
      invite: "invitz_new_invite",
      verify: "invitz_verify_code",
      digest: "invitz_digest",
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: "wamid.HBgM123" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 131026, message: "Message undeliverable" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      );

    const wa = getAdapter("whatsapp")!;
    const ok = await wa.send("+14155550123", {
      kind: "digest",
      title: "Your Digest",
      text: "1. Meetup",
      url: "https://invitz.app/notifications",
    });
    expect(ok.ok).toBe(true);
    expect(ok.providerMessageId).toBe("wamid.HBgM123");
    const sentPayload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { template?: { name?: string } };
    expect(sentPayload.template?.name).toBe("invitz_digest");

    const bad = await wa.send("+14155550123", { title: "Hi", text: "Test", url: "https://invitz.app" });
    expect(bad.ok).toBe(false);
    expect(bad.permanentFailure).toBe(true);
  });

  it("Signal enforces kill switch and detects unregistered numbers", async () => {
    process.env.NOTIFY_DRY_RUN = "false";
    process.env.SIGNAL_API_URL = "http://signal.internal:8080";
    process.env.SIGNAL_SENDER = "+14155550000";
    process.env.SIGNAL_ENABLED = "false";

    const sig = getAdapter("signal")!;
    expect(sig.beta).toBe(true);
    expect(sig.configured()).toBe(false);
    const killRes = await sig.send("+14155550123", { title: "T", text: "B", url: "https://invitz.app" });
    expect(killRes.ok).toBe(false);
    expect(killRes.statusCode).toBe(503);

    process.env.SIGNAL_ENABLED = "true";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unregistered user" }), { status: 400 }),
    );
    const unregRes = await sig.send("+14155550123", { title: "T", text: "B", url: "https://invitz.app" });
    expect(unregRes.ok).toBe(false);
    expect(unregRes.unregistered).toBe(true);
    expect(unregRes.permanentFailure).toBe(true);
  });

  it("Telegram escapes HTML and marks blocked bots permanentFailure", async () => {
    process.env.NOTIFY_DRY_RUN = "false";
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was blocked by the user" }), {
          status: 403,
        }),
      );

    const tg = getAdapter("telegram")!;
    const ok = await tg.send("987654321", {
      title: "Event <Test>",
      text: "Join & learn",
      url: "https://invitz.app/invites/1",
    });
    expect(ok.ok).toBe(true);
    expect(ok.providerMessageId).toBe("42");
    const tgPayload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { text: string };
    expect(tgPayload.text).toContain("&lt;Test&gt;");
    expect(tgPayload.text).toContain("Join &amp; learn");

    const blocked = await tg.send("987654321", { title: "T", text: "B", url: "https://invitz.app" });
    expect(blocked.ok).toBe(false);
    expect(blocked.permanentFailure).toBe(true);
  });

  it("Email adapter sends RFC 8058 List-Unsubscribe headers via Resend", async () => {
    process.env.NOTIFY_DRY_RUN = "false";
    process.env.RESEND_API_KEY = "re_test_123";
    process.env.EMAIL_FROM = "Invitz <no-reply@invitz.app>";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "email_123" }), { status: 200 }),
    );

    const email = getAdapter("email")!;
    const res = await email.send("ada@example.com", {
      kind: "invite",
      title: "✅ Berlin MLOps",
      text: "Tomorrow at 18:00",
      url: "https://invitz.app/invites/1",
      unsubscribeUrl: "https://invitz.app/api/notifications/unsubscribe?token=abc.sig",
    });
    expect(res.ok).toBe(true);
    expect(res.providerMessageId).toBe("email_123");
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      headers: Record<string, string>;
      html: string;
      text: string;
    };
    expect(payload.headers["List-Unsubscribe"]).toBe(
      "<https://invitz.app/api/notifications/unsubscribe?token=abc.sig>",
    );
    expect(payload.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(payload.html).toContain("Unsubscribe in one click");
    expect(payload.text).toContain("Unsubscribe:");
  });
});

describe("Webhook signature verification & security routes", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("Discord webhook verifies Ed25519 signatures and handles PING", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spkiDer = publicKey.export({ format: "der", type: "spki" });
    // Raw 32-byte key is the trailing 32 bytes of SPKI DER
    process.env.DISCORD_PUBLIC_KEY = spkiDer.subarray(-32).toString("hex");

    const { POST } = await import("@/app/api/webhooks/discord/route");
    const body = JSON.stringify({ type: 1 });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign(null, Buffer.from(ts + body, "utf8"), privateKey).toString("hex");

    const badRes = await POST(
      new Request("http://localhost/api/webhooks/discord", {
        method: "POST",
        headers: { "x-signature-ed25519": "0".repeat(128), "x-signature-timestamp": ts },
        body,
      }),
    );
    expect(badRes.status).toBe(401);

    const goodRes = await POST(
      new Request("http://localhost/api/webhooks/discord", {
        method: "POST",
        headers: { "x-signature-ed25519": sig, "x-signature-timestamp": ts },
        body,
      }),
    );
    expect(goodRes.status).toBe(200);
    expect(await goodRes.json()).toEqual({ type: 1 });
  });

  it("WhatsApp webhook handles challenge and enforces HMAC X-Hub-Signature-256 on STOP", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "meta-verify-secret";
    process.env.WHATSAPP_APP_SECRET = "meta-app-secret";

    const disabledCalls: unknown[] = [];
    vi.doMock("@/db", () => ({
      db: {
        update: () => ({
          set: (vals: unknown) => {
            disabledCalls.push(vals);
            return {
              where: () => ({
                returning: () => Promise.resolve([{ id: "ch-1" }]),
              }),
            };
          },
        }),
      },
    }));

    const { GET, POST } = await import("@/app/api/webhooks/whatsapp/route");
    const challengeRes = await GET(
      new Request("http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=meta-verify-secret&hub.challenge=98765"),
    );
    expect(challengeRes.status).toBe(200);
    expect(await challengeRes.text()).toBe("98765");

    const payload = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: "14155550123", type: "text", text: { body: "STOP" } }],
              },
            },
          ],
        },
      ],
    });
    const sig = `sha256=${createHmac("sha256", "meta-app-secret").update(payload).digest("hex")}`;

    const badPost = await POST(
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=deadbeef" },
        body: payload,
      }),
    );
    expect(badPost.status).toBe(401);

    const goodPost = await POST(
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": sig },
        body: payload,
      }),
    );
    expect(goodPost.status).toBe(200);
    const json = (await goodPost.json()) as { unsubscribed: number };
    expect(json.unsubscribed).toBe(1);
    expect((disabledCalls[0] as { enabled: boolean }).enabled).toBe(false);
  });

  it("One-click email unsubscribe verifies signed tokens and rejects forged tokens", async () => {
    const updatedIds: string[] = [];
    vi.doMock("@/db", () => ({
      db: {
        update: () => ({
          set: () => ({
            where: () => ({
              returning: () => {
                updatedIds.push("ch-email-1");
                return Promise.resolve([{ id: "ch-email-1" }]);
              },
            }),
          }),
        }),
      },
    }));

    const { signUnsubscribeToken } = await import("@/lib/crypto");
    const { POST } = await import("@/app/api/notifications/unsubscribe/route");

    const forged = await POST(
      new Request("http://localhost/api/notifications/unsubscribe?token=ch-email-1.bad", { method: "POST" }),
    );
    expect(forged.status).toBe(400);

    const validToken = signUnsubscribeToken("ch-email-1");
    const ok = await POST(
      new Request(`http://localhost/api/notifications/unsubscribe?token=${encodeURIComponent(validToken)}`, {
        method: "POST",
      }),
    );
    expect(ok.status).toBe(200);
    expect(updatedIds).toEqual(["ch-email-1"]);
  });
});
