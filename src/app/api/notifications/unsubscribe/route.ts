import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationChannels } from "@/db/schema";
import { verifyUnsubscribeToken } from "@/lib/crypto";

export const dynamic = "force-dynamic";

async function extractToken(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken;
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData().catch(() => null);
      const t = form?.get("token");
      if (typeof t === "string") return t;
    }
  }
  return null;
}

async function disableChannelByToken(token: string | null) {
  if (!token) return { ok: false as const, reason: "Missing unsubscribe token." };
  const channelId = verifyUnsubscribeToken(token);
  if (!channelId) return { ok: false as const, reason: "Invalid or expired unsubscribe token." };

  const updated = await db
    .update(notificationChannels)
    .set({
      enabled: false,
      disabledReason: "Unsubscribed via one-click email link.",
    })
    .where(eq(notificationChannels.id, channelId))
    .returning({ id: notificationChannels.id });

  if (updated.length === 0) {
    return { ok: false as const, reason: "Channel was already removed." };
  }
  return { ok: true as const };
}

export async function POST(request: Request) {
  const token = await extractToken(request);
  const res = await disableChannelByToken(token);
  if (!res.ok) {
    return Response.json({ ok: false, error: res.reason }, { status: 400 });
  }
  return Response.json({ ok: true }, { status: 200 });
}

export async function GET(request: Request) {
  const token = await extractToken(request);
  const res = await disableChannelByToken(token);
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Invitz Unsubscribe</title></head>
<body style="margin:0;padding:32px;background:#F7F4EC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#201F1C;">
  <div style="max-width:480px;margin:40px auto;background:#FFFFFF;border:1px solid #E5DFD2;border-radius:12px;padding:28px;">
    <h1 style="margin:0 0 10px;font-size:22px;">${res.ok ? "Email notifications paused" : "Could not unsubscribe"}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#5D5A52;">
      ${
        res.ok
          ? "You have been unsubscribed from this Invitz email notification channel. You can re-enable or configure digests anytime in Settings."
          : res.reason
      }
    </p>
    <a href="/settings" style="display:inline-block;background:#2F6B4F;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;">Go to Settings</a>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: res.ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
