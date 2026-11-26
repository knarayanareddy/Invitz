import type { ChannelType } from "@/db/schema";

/**
 * Notification channel adapters. To add Telegram / email / Slack / push:
 *   1. add the type to `ChannelType` in schema.ts
 *   2. write one adapter below and register it in ADAPTERS
 * Nothing else (fan-out, retries, UI list) needs to change.
 */

export type OutboundMessage = {
  title: string;
  text: string;
  url: string;
  kind?: "invite" | "verify";
  verifyCode?: string;
};
export type SendResult = { ok: boolean; dryRun?: boolean; error?: string };

export interface ChannelAdapter {
  type: ChannelType;
  label: string;
  destinationLabel: string;
  placeholder: string;
  /** Is the server able to send on this channel (env configured)? Discord webhooks need no server config. */
  configured(): boolean;
  /** Returns an error string, or null if the destination is acceptable. */
  validate(destination: string): string | null;
  send(destination: string, message: OutboundMessage): Promise<SendResult>;
}

const dryRunForced = () => process.env.NOTIFY_DRY_RUN === "true";

async function post(url: string, init: RequestInit): Promise<SendResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      let detail = "";
      try {
        const text = await res.text();
        if (text) detail = `: ${text.slice(0, 160)}`;
      } catch {
        /* ignore body read error */
      }
      return { ok: false, error: `HTTP ${res.status}${detail}` };
    }
    await res.body?.cancel().catch(() => undefined);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

const E164 = /^\+[1-9]\d{7,14}$/;
const DISCORD_WEBHOOK_RE =
  /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w.-]+(?:\?thread_id=\d+)?$/;

export function formatDiscordContent(m: OutboundMessage): string {
  const safeTitle = m.title.replace(/[*_`~|>]/g, "\\$&");
  const header = `**${safeTitle}**`;
  const footer = `\n${m.url}`;
  const maxBody = Math.max(0, 1900 - header.length - footer.length - 1);
  const body = m.text.length > maxBody ? `${m.text.slice(0, Math.max(0, maxBody - 1))}…` : m.text;
  return body ? `${header}\n${body}${footer}` : `${header}${footer}`;
}

export function normalizePhone(destination: string): string {
  return destination.replace(/[\s()-]/g, "");
}

const discord: ChannelAdapter = {
  type: "discord",
  label: "Discord",
  destinationLabel: "Webhook URL",
  placeholder: "https://discord.com/api/webhooks/…",
  configured: () => !dryRunForced(),
  validate: (d) =>
    DISCORD_WEBHOOK_RE.test(d.trim())
      ? null
      : "Enter a valid Discord webhook URL (Server settings → Integrations → Webhooks).",
  send: async (dest, m) => {
    if (dryRunForced()) return { ok: true, dryRun: true };
    return post(dest, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "Invitz",
        content: formatDiscordContent(m),
        allowed_mentions: { parse: [] },
      }),
    });
  },
};

const whatsapp: ChannelAdapter = {
  type: "whatsapp",
  label: "WhatsApp",
  destinationLabel: "Phone number (E.164)",
  placeholder: "+4915112345678",
  configured: () => !dryRunForced() && !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID,
  validate: (d) => (E164.test(normalizePhone(d)) ? null : "Use international format, e.g. +14155550123."),
  send: async (dest, m) => {
    if (!whatsapp.configured()) return { ok: true, dryRun: true };
    const isVerify = m.kind === "verify";
    const template = isVerify ? process.env.WHATSAPP_VERIFY_TEMPLATE_NAME : process.env.WHATSAPP_TEMPLATE_NAME;
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
                    text: isVerify && m.verifyCode ? m.verifyCode : rawBody.replace(/\n/g, " · "),
                  },
                ],
              },
            ],
          },
        }
      : { messaging_product: "whatsapp", to: normalizePhone(dest).replace("+", ""), type: "text", text: { body: rawBody } };

    return post(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
};

const signal: ChannelAdapter = {
  type: "signal",
  label: "Signal",
  destinationLabel: "Phone number (E.164)",
  placeholder: "+14155550123",
  configured: () => !dryRunForced() && !!process.env.SIGNAL_API_URL && !!process.env.SIGNAL_SENDER,
  validate: (d) => (E164.test(normalizePhone(d)) ? null : "Use international format, e.g. +14155550123."),
  send: async (dest, m) => {
    if (!signal.configured()) return { ok: true, dryRun: true };
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (process.env.SIGNAL_API_KEY) {
      headers.authorization = `Bearer ${process.env.SIGNAL_API_KEY}`;
    }
    // Talks to a self-hosted https://github.com/bbernhard/signal-cli-rest-api instance.
    return post(`${process.env.SIGNAL_API_URL!.replace(/\/$/, "")}/v2/send`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: `${m.title}\n${m.text}\n${m.url}`,
        number: process.env.SIGNAL_SENDER,
        recipients: [normalizePhone(dest)],
      }),
    });
  },
};

export const ADAPTERS: Record<ChannelType, ChannelAdapter> = { discord, whatsapp, signal };
export const CHANNEL_TYPES = Object.keys(ADAPTERS) as ChannelType[];

export function getAdapter(type: string): ChannelAdapter | null {
  return Object.hasOwn(ADAPTERS, type) ? ADAPTERS[type as ChannelType] : null;
}
