import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationChannels, notifications } from "@/db/schema";
import { hashDestination } from "@/lib/crypto";
import { getAdapter } from "@/lib/notify/adapters";

export const dynamic = "force-dynamic";

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);

function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length > 0 && ba.length === bb.length && timingSafeEqual(ba, bb);
}

function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return safeCompare(signatureHeader, expected);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? "";

  if (mode === "subscribe" && expected && safeCompare(token, expected)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return Response.json({ error: "Forbidden" }, { status: 403 });
}

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        statuses?: Array<{
          id?: string;
          status?: string;
          errors?: Array<{ code?: number; title?: string; message?: string }>;
        }>;
        messages?: Array<{
          from?: string;
          type?: string;
          text?: { body?: string };
        }>;
      };
    }>;
  }>;
};

export async function POST(request: Request) {
  const rawBytes = Buffer.from(await request.arrayBuffer());
  if (!verifyMetaSignature(rawBytes, request.headers.get("x-hub-signature-256"))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBytes.toString("utf8")) as WhatsAppWebhookPayload;
  } catch {
    return Response.json({ error: "Malformed JSON" }, { status: 400 });
  }

  let updatedStatuses = 0;
  let unsubscribed = 0;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      for (const st of value.statuses ?? []) {
        if (!st.id || !st.status) continue;
        const deliveryStatus = st.status.slice(0, 32);
        const errInfo = st.errors?.[0];
        const errText = errInfo ? `WhatsApp ${errInfo.code ?? ""}: ${errInfo.title ?? errInfo.message ?? "failed"}`.trim() : null;
        await db
          .update(notifications)
          .set({
            deliveryStatus,
            ...(deliveryStatus === "failed" ? { status: "failed", error: errText ?? "WhatsApp delivery failed" } : {}),
          })
          .where(eq(notifications.providerMessageId, st.id));
        updatedStatuses += 1;
      }

      for (const msg of value.messages ?? []) {
        const body = msg.text?.body?.trim().toUpperCase();
        const from = msg.from?.replace(/[^\d]/g, "");
        if (!from || !body) continue;
        const firstWord = body.split(/\s+/)[0] ?? "";
        if (!STOP_KEYWORDS.has(firstWord)) continue;

        const phone = `+${from}`;
        const destHash = hashDestination("whatsapp", phone);
        const disabled = await db
          .update(notificationChannels)
          .set({
            enabled: false,
            disabledReason: "Unsubscribed via WhatsApp STOP message.",
          })
          .where(and(eq(notificationChannels.type, "whatsapp"), eq(notificationChannels.destinationHash, destHash)))
          .returning({ id: notificationChannels.id });

        unsubscribed += disabled.length;

        const adapter = getAdapter("whatsapp");
        if (disabled.length > 0 && adapter?.configured()) {
          await adapter
            .send(phone, {
              kind: "verify",
              title: "Invitz Opt-out Confirmed",
              text: "You have been unsubscribed from Invitz WhatsApp alerts. Re-enable anytime in your Invitz Settings.",
              url: "https://invitz.app/settings",
            })
            .catch(() => undefined);
        }
      }
    }
  }

  return Response.json({ ok: true, updatedStatuses, unsubscribed });
}
