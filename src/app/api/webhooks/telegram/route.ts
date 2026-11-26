import { timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { notificationChannels } from "@/db/schema";
import { encryptSecret, hashDestination, hashVerifySecret } from "@/lib/crypto";
import { getAdapter } from "@/lib/notify/adapters";

export const dynamic = "force-dynamic";

function verifyTelegramSecret(headerSecret: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !headerSecret) return false;
  const a = Buffer.from(headerSecret, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number | string; username?: string; type?: string };
  };
};

export async function POST(request: Request) {
  if (!verifyTelegramSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return Response.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const text = update.message?.text?.trim() ?? "";
  const chatIdRaw = update.message?.chat?.id;
  if (!chatIdRaw || !text) {
    return Response.json({ ok: true });
  }

  const chatId = String(chatIdRaw);
  const adapter = getAdapter("telegram");

  if (text.startsWith("/start")) {
    const token = text.slice("/start".length).trim();
    if (!token) {
      return Response.json({ ok: true });
    }
    const tokenHash = hashVerifySecret(token);
    const [ch] = await db
      .select()
      .from(notificationChannels)
      .where(
        and(
          eq(notificationChannels.type, "telegram"),
          eq(notificationChannels.verifyTokenHash, tokenHash),
          gt(notificationChannels.verifyExpiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!ch) {
      if (adapter?.configured()) {
        await adapter
          .send(chatId, {
            kind: "verify",
            title: "Link expired",
            text: "This verification token is invalid or expired. Generate a fresh link from Invitz Settings.",
            url: "https://invitz.app/settings",
          })
          .catch(() => undefined);
      }
      return Response.json({ ok: true, linked: false });
    }

    const { ciphertext, keyId } = encryptSecret(chatId);
    const destinationHash = hashDestination("telegram", chatId);
    await db
      .update(notificationChannels)
      .set({
        destination: ciphertext,
        destinationHash,
        destinationKeyId: keyId,
        verified: true,
        verifiedDryRun: adapter ? !adapter.configured() : true,
        enabled: true,
        verifyCode: null,
        verifyCodeHash: null,
        verifyTokenHash: null,
        verifyExpiresAt: null,
        verifyAttempts: 0,
        failureCount: 0,
        disabledReason: null,
      })
      .where(eq(notificationChannels.id, ch.id));

    if (adapter?.configured()) {
      await adapter
        .send(chatId, {
          kind: "verify",
          title: "Telegram connected",
          text: "Your Telegram chat is verified and connected to Invitz. Reply /stop anytime to pause notifications.",
          url: "https://invitz.app/settings",
        })
        .catch(() => undefined);
    }

    return Response.json({ ok: true, linked: true });
  }

  if (text === "/stop" || text.startsWith("/stop ")) {
    const destHash = hashDestination("telegram", chatId);
    await db
      .update(notificationChannels)
      .set({ enabled: false, disabledReason: "Paused via /stop command in Telegram." })
      .where(and(eq(notificationChannels.type, "telegram"), eq(notificationChannels.destinationHash, destHash)));
    return Response.json({ ok: true, stopped: true });
  }

  return Response.json({ ok: true });
}
