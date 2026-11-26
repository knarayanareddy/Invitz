import { timingSafeEqual } from "node:crypto";
import { processDueNotificationsAndDigests } from "@/lib/notify/dispatch";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(auth, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await processDueNotificationsAndDigests(new Date());
  return Response.json({ ok: true, ...summary, ranAt: new Date().toISOString() });
}

export async function GET(request: Request) {
  return POST(request);
}
