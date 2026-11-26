import type { ChannelType } from "@/db/schema";

/**
 * Notification channel adapters:
 *   - discord (webhook embeds + guild bot subscription support)
 *   - whatsapp (Meta Cloud API with approved templates + consent/STOP opt-out)
 *   - signal (signal-cli-rest-api, 1 msg/s throttle + Beta flag + SIGNAL_ENABLED kill switch)
 *   - telegram (Bot API sendMessage + /start deep-link verification)
 *   - email (Resend REST API + RFC 8058 List-Unsubscribe + digest & fallback)
 */

export type DigestItem = {
  title: string;
  url: string;
  when?: string;
  location?: string;
  sharerHandle: string;
  caution?: boolean;
};

export type OutboundMessage = {
  title: string;
  text: string;
  url: string;
  kind?: "invite" | "verify" | "digest" | "fallback";
  verifyCode?: string;
  caution?: boolean;
  eventWhen?: string;
  eventLocation?: string;
  sharerHandle?: string;
  reason?: string;
  eventUrl?: string;
  groupNames?: string[];
  unsubscribeUrl?: string;
  digestItems?: DigestItem[];
};

export type SendResult = {
  ok: boolean;
  dryRun?: boolean;
  error?: string;
  statusCode?: number;
  retryAfterMs?: number;
  providerMessageId?: string;
  permanentFailure?: boolean;
  unregistered?: boolean;
  rateLimited?: boolean;
};

export interface ChannelAdapter {
  type: ChannelType;
  label: string;
  destinationLabel: string;
  placeholder: string;
  beta?: boolean;
  consentRequired?: boolean;
  verificationKind?: "code" | "token_link";
  /** Is the server able to send on this channel (env configured)? Discord webhooks need no server config. */
  configured(): boolean;
  disabledReason?: () => string | null;
  /** Returns an error string, or null if the destination is acceptable. */
  validate(destination: string): string | null;
  send(destination: string, message: OutboundMessage): Promise<SendResult>;
}

const dryRunForced = () => process.env.NOTIFY_DRY_RUN === "true";

function parseRetryAfterMs(headerVal: string | null, bodyText: string): number | undefined {
  if (headerVal) {
    const num = Number(headerVal);
    if (Number.isFinite(num) && num >= 0) {
      return Math.min(Math.max(Math.round(num * 1000), 1000), 300_000);
    }
    const parsedDate = Date.parse(headerVal);
    if (!Number.isNaN(parsedDate)) {
      return Math.min(Math.max(parsedDate - Date.now(), 1000), 300_000);
    }
  }
  if (bodyText) {
    try {
      const json = JSON.parse(bodyText) as Record<string, unknown>;
      const retrySec =
        typeof json.retry_after === "number"
          ? json.retry_after
          : typeof (json.parameters as Record<string, unknown> | undefined)?.retry_after === "number"
            ? ((json.parameters as Record<string, unknown>).retry_after as number)
            : null;
      if (retrySec !== null && Number.isFinite(retrySec)) {
        // Discord returns retry_after in seconds (float), Telegram in integer seconds
        return Math.min(Math.max(Math.round(retrySec * 1000), 1000), 300_000);
      }
    } catch {
      // Not JSON
    }
  }
  return undefined;
}

async function postJson(url: string, init: RequestInit): Promise<SendResult & { json?: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
    const bodyText = await res.text().catch(() => "");
    let json: Record<string, unknown> | undefined;
    if (bodyText) {
      try {
        json = JSON.parse(bodyText) as Record<string, unknown>;
      } catch {
        // Plain text error body
      }
    }

    if (!res.ok) {
      const retryAfterMs = res.status === 429 ? parseRetryAfterMs(res.headers.get("retry-after"), bodyText) : undefined;
      const permanentFailure = res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410;
      const detail = bodyText ? `: ${bodyText.slice(0, 180)}` : "";
      return {
        ok: false,
        statusCode: res.status,
        retryAfterMs,
        rateLimited: res.status === 429,
        permanentFailure,
        error: `HTTP ${res.status}${detail}`,
        json,
      };
    }

    return { ok: true, statusCode: res.status, json };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DISCORD_WEBHOOK_RE =
  /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w.-]+(?:\?thread_id=\d+)?$/;
const TELEGRAM_DEST_RE = /^(?:-?\d{5,20}|@[A-Za-z0-9_]{5,32}|pending:[a-f0-9-]{8,})$/;

export function formatDiscordContent(m: OutboundMessage): string {
  const safeTitle = m.title.replace(/[*_`~|>]/g, "\\$&");
  const header = `**${safeTitle}**`;
  const footer = `\n${m.url}`;
  const maxBody = Math.max(0, 1900 - header.length - footer.length - 1);
  const body = m.text.length > maxBody ? `${m.text.slice(0, Math.max(0, maxBody - 1))}…` : m.text;
  return body ? `${header}\n${body}${footer}` : `${header}${footer}`;
}

function buildDiscordPayload(m: OutboundMessage) {
  if (m.kind === "verify") {
    return {
      username: "Invitz",
      content: formatDiscordContent(m),
      allowed_mentions: { parse: [] },
    };
  }

  if (m.kind === "digest" && m.digestItems?.length) {
    const lines = m.digestItems.slice(0, 12).map((item, idx) => {
      const meta = [item.when, item.location].filter(Boolean).join(" · ");
      const badge = item.caution ? "⚠️ " : "✅ ";
      return `${idx + 1}. ${badge}[**${item.title.slice(0, 80)}**](${item.url})${meta ? ` — ${meta}` : ""} (@${item.sharerHandle})`;
    });
    return {
      username: "Invitz",
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: m.title.slice(0, 250),
          url: m.url,
          description: lines.join("\n").slice(0, 3900),
          color: 0x2f6b4f,
          footer: { text: "Invitz Digest · Curated events" },
        },
      ],
    };
  }

  const color = m.caution ? 0xb25e18 : 0x2f6b4f;
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (m.eventWhen) fields.push({ name: "When", value: m.eventWhen.slice(0, 256), inline: true });
  if (m.eventLocation) fields.push({ name: "Where", value: m.eventLocation.slice(0, 256), inline: true });
  if (m.sharerHandle) fields.push({ name: "Shared by", value: `@${m.sharerHandle}`, inline: true });
  if (m.reason) fields.push({ name: "Why you got this", value: m.reason.slice(0, 512), inline: false });
  if (m.eventUrl) fields.push({ name: "Event link", value: m.eventUrl.slice(0, 512), inline: false });

  return {
    username: "Invitz",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: m.title.slice(0, 250),
        url: m.url,
        description: m.text.slice(0, 3500),
        color,
        fields: fields.slice(0, 6),
        footer: {
          text: m.caution
            ? "Invitz Caution · Proceed with care before attending or signing up"
            : "Invitz Verified · Shared by a community member",
        },
      },
    ],
  };
}

export function normalizePhone(destination: string): string {
  return destination.replace(/[\s()-]/g, "");
}

const discord: ChannelAdapter = {
  type: "discord",
  label: "Discord",
  destinationLabel: "Webhook URL",
  placeholder: "https://discord.com/api/webhooks/…",
  verificationKind: "code",
  configured: () => !dryRunForced(),
  validate: (d) =>
    DISCORD_WEBHOOK_RE.test(d.trim())
      ? null
      : "Enter a valid Discord webhook URL (Server settings → Integrations → Webhooks).",
  send: async (dest, m) => {
    if (dryRunForced()) return { ok: true, dryRun: true };
    const result = await postJson(dest, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildDiscordPayload(m)),
    });
    if (!result.ok) {
      const code = typeof result.json?.code === "number" ? result.json.code : undefined;
      if (code === 10015 || result.statusCode === 404 || result.statusCode === 401 || result.statusCode === 403) {
        return { ...result, permanentFailure: true };
      }
    }
    return result;
  },
};

function resolveWhatsAppTemplate(kind: OutboundMessage["kind"]): string | undefined {
  const mapJson = process.env.WHATSAPP_TEMPLATE_MAP;
  if (mapJson) {
    try {
      const parsed = JSON.parse(mapJson) as Record<string, unknown>;
      const mapped = kind ? parsed[kind] : parsed.invite;
      if (typeof mapped === "string" && mapped.trim()) return mapped.trim();
    } catch {
      // Ignore invalid template map JSON
    }
  }
  if (kind === "verify") return process.env.WHATSAPP_VERIFY_TEMPLATE_NAME;
  if (kind === "digest") return process.env.WHATSAPP_DIGEST_TEMPLATE_NAME ?? process.env.WHATSAPP_TEMPLATE_NAME;
  return process.env.WHATSAPP_TEMPLATE_NAME;
}

const whatsapp: ChannelAdapter = {
  type: "whatsapp",
  label: "WhatsApp",
  destinationLabel: "Phone number (E.164)",
  placeholder: "+4915112345678",
  consentRequired: true,
  verificationKind: "code",
  configured: () => !dryRunForced() && !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID,
  validate: (d) => (E164.test(normalizePhone(d)) ? null : "Use international format, e.g. +14155550123."),
  send: async (dest, m) => {
    if (!whatsapp.configured()) return { ok: true, dryRun: true };
    const isVerify = m.kind === "verify";
    const template = resolveWhatsAppTemplate(m.kind);
    const rawBody = `${m.title}\n${m.text}\n${m.url}`.slice(0, 1000);
    // Business-initiated WhatsApp messages MUST use an approved template outside the 24h window.
    const payload = template
      ? {
          messaging_product: "whatsapp",
          to: normalizePhone(dest).replace("+", ""),
          type: "template",
          template: {
            name: template,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "en" },
            components: [
              {
                type: "body",
                parameters: [
                  {
                    type: "text",
                    text: isVerify && m.verifyCode ? m.verifyCode : rawBody.replace(/\n/g, " · ").slice(0, 950),
                  },
                ],
              },
            ],
          },
        }
      : { messaging_product: "whatsapp", to: normalizePhone(dest).replace("+", ""), type: "text", text: { body: rawBody } };

    const result = await postJson(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (result.ok) {
      const messages = Array.isArray(result.json?.messages) ? (result.json?.messages as { id?: string }[]) : [];
      return { ok: true, statusCode: result.statusCode, providerMessageId: messages[0]?.id };
    }
    const waError = result.json?.error as Record<string, unknown> | undefined;
    const waCode = typeof waError?.code === "number" ? waError.code : undefined;
    if (waCode === 131026 || waCode === 131051 || result.statusCode === 400) {
      return { ...result, permanentFailure: waCode === 131026 || waCode === 131051 };
    }
    return result;
  },
};

// In-process rate gate for Signal (1 msg/s self-hosted signal-cli-rest-api throttle).
let signalNextSlotAt = 0;

async function waitForSignalSlot(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, signalNextSlotAt - now);
  signalNextSlotAt = Math.max(now, signalNextSlotAt) + 1000;
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

const signalKillSwitched = () => process.env.SIGNAL_ENABLED === "false";

const signal: ChannelAdapter = {
  type: "signal",
  label: "Signal",
  destinationLabel: "Phone number (E.164)",
  placeholder: "+14155550123",
  beta: true,
  verificationKind: "code",
  disabledReason: () => (signalKillSwitched() ? "Signal delivery is paused via SIGNAL_ENABLED=false." : null),
  configured: () =>
    !dryRunForced() && !signalKillSwitched() && !!process.env.SIGNAL_API_URL && !!process.env.SIGNAL_SENDER,
  validate: (d) => (E164.test(normalizePhone(d)) ? null : "Use international format, e.g. +14155550123."),
  send: async (dest, m) => {
    if (signalKillSwitched()) {
      return { ok: false, error: "Signal channel disabled by SIGNAL_ENABLED=false", statusCode: 503 };
    }
    if (!signal.configured()) return { ok: true, dryRun: true };
    await waitForSignalSlot();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (process.env.SIGNAL_API_KEY) {
      headers.authorization = `Bearer ${process.env.SIGNAL_API_KEY}`;
    }
    const result = await postJson(`${process.env.SIGNAL_API_URL!.replace(/\/$/, "")}/v2/send`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: `${m.title}\n${m.text}\n${m.url}`,
        number: process.env.SIGNAL_SENDER,
        recipients: [normalizePhone(dest)],
      }),
    });
    if (!result.ok) {
      const errText = (result.error ?? "").toLowerCase();
      if (errText.includes("unregistered") || errText.includes("not registered")) {
        return { ...result, unregistered: true, permanentFailure: true };
      }
    }
    return result;
  },
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const telegram: ChannelAdapter = {
  type: "telegram",
  label: "Telegram",
  destinationLabel: "Chat ID or @channel (or click Link Bot)",
  placeholder: "123456789 or @channel",
  verificationKind: "token_link",
  configured: () => !dryRunForced() && !!process.env.TELEGRAM_BOT_TOKEN,
  validate: (d) => {
    const trimmed = d.trim();
    if (!trimmed) return "Enter a Telegram chat ID, @channel, or use Connect via Telegram bot.";
    if (!TELEGRAM_DEST_RE.test(trimmed)) {
      return "Enter a numeric Telegram chat ID (e.g. 123456789) or public @channel handle.";
    }
    return null;
  },
  send: async (dest, m) => {
    if (dest.startsWith("pending:")) {
      return { ok: true, dryRun: true };
    }
    if (!telegram.configured()) return { ok: true, dryRun: true };
    const safeTitle = escapeHtml(m.title);
    const safeText = escapeHtml(m.text);
    const safeUrl = escapeHtml(m.url);
    const html = `<b>${safeTitle}</b>\n\n${safeText}\n\n<a href="${safeUrl}">Open on Invitz</a>`.slice(0, 4000);

    const result = await postJson(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: dest.trim(),
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });

    if (result.ok) {
      const msgObj = result.json?.result as { message_id?: number } | undefined;
      return {
        ok: true,
        statusCode: result.statusCode,
        providerMessageId: msgObj?.message_id ? String(msgObj.message_id) : undefined,
      };
    }

    const desc = typeof result.json?.description === "string" ? result.json.description.toLowerCase() : "";
    if (
      result.statusCode === 403 ||
      desc.includes("bot was blocked") ||
      desc.includes("chat not found") ||
      desc.includes("user is deactivated")
    ) {
      return { ...result, permanentFailure: true };
    }
    return result;
  },
};

function renderEmailHtml(m: OutboundMessage): string {
  const accent = m.caution ? "#B25E18" : "#2F6B4F";
  const digestBlock =
    m.kind === "digest" && m.digestItems?.length
      ? `<ul style="padding-left:18px;margin:16px 0;color:#201F1C;">${m.digestItems
          .map(
            (i) =>
              `<li style="margin-bottom:10px;"><a href="${escapeHtml(i.url)}" style="color:${accent};font-weight:600;text-decoration:none;">${escapeHtml(i.title)}</a>${
                i.when || i.location ? `<div style="font-size:13px;color:#5D5A52;">${escapeHtml([i.when, i.location].filter(Boolean).join(" · "))}</div>` : ""
              }</li>`,
          )
          .join("")}</ul>`
      : "";

  const unsubFooter = m.unsubscribeUrl
    ? `<p style="margin-top:24px;font-size:12px;color:#78746A;">Don't want these emails? <a href="${escapeHtml(m.unsubscribeUrl)}" style="color:#5D5A52;">Unsubscribe in one click</a>.</p>`
    : "";

  return `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#F7F4EC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#201F1C;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E5DFD2;border-radius:12px;padding:28px;">
    <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${accent};font-weight:700;margin-bottom:8px;">Invitz</div>
    <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#201F1C;">${escapeHtml(m.title)}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;white-space:pre-line;color:#3D3B37;">${escapeHtml(m.text)}</p>
    ${digestBlock}
    <p style="margin:20px 0 0;"><a href="${escapeHtml(m.url)}" style="display:inline-block;background:${accent};color:#FFFFFF;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;">View on Invitz</a></p>
    ${unsubFooter}
  </div>
</body>
</html>`;
}

const email: ChannelAdapter = {
  type: "email",
  label: "E-mail",
  destinationLabel: "Email address",
  placeholder: "you@example.com",
  verificationKind: "code",
  configured: () => !dryRunForced() && !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM,
  validate: (d) => (EMAIL_RE.test(d.trim()) ? null : "Enter a valid email address."),
  send: async (dest, m) => {
    if (!email.configured()) return { ok: true, dryRun: true };
    const headers: Record<string, string> = {};
    if (m.unsubscribeUrl) {
      headers["List-Unsubscribe"] = `<${m.unsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    const textBody = m.unsubscribeUrl
      ? `${m.title}\n\n${m.text}\n\n${m.url}\n\nUnsubscribe: ${m.unsubscribeUrl}`
      : `${m.title}\n\n${m.text}\n\n${m.url}`;

    const result = await postJson("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [dest.trim().toLowerCase()],
        subject: m.title.slice(0, 140),
        text: textBody,
        html: renderEmailHtml(m),
        headers,
      }),
    });

    if (result.ok) {
      return {
        ok: true,
        statusCode: result.statusCode,
        providerMessageId: typeof result.json?.id === "string" ? result.json.id : undefined,
      };
    }
    if (result.statusCode === 422 || result.statusCode === 400) {
      return { ...result, permanentFailure: true };
    }
    return result;
  },
};

export const ADAPTERS: Record<ChannelType, ChannelAdapter> = {
  discord,
  telegram,
  whatsapp,
  signal,
  email,
};
export const CHANNEL_TYPES = Object.keys(ADAPTERS) as ChannelType[];

export function getAdapter(type: string): ChannelAdapter | null {
  return Object.hasOwn(ADAPTERS, type) ? ADAPTERS[type as ChannelType] : null;
}

export function clearSignalThrottleForTest() {
  signalNextSlotAt = 0;
}
