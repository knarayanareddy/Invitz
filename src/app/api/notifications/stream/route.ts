import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { subscribeUserBell } from "@/lib/notify/realtime";

export const dynamic = "force-dynamic";

async function getUnreadCount(userId: string): Promise<number> {
  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.channel, "in_app"), isNull(notifications.readAt)));
  return unread;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const sendEvent = (eventName: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const initialUnread = await getUnreadCount(user.id).catch(() => 0);
      sendEvent("bell", { unreadCount: initialUnread, kind: "sync", at: new Date().toISOString() });

      const unsub = subscribeUserBell(user.id, async (payload) => {
        const unreadCount =
          typeof payload.unreadCount === "number"
            ? payload.unreadCount
            : await getUnreadCount(user.id).catch(() => 0);
        sendEvent("bell", { ...payload, unreadCount });
      });

      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      }, 20_000);

      const closeAll = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        unsub();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      cleanup = closeAll;
      request.signal.addEventListener("abort", closeAll);
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
