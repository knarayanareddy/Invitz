import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { consumeAuthRateLimit } from "@/lib/rate-limit";

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export const GET = handlers.GET;

export async function POST(req: NextRequest) {
  if (req.nextUrl.pathname.endsWith("/signin/resend")) {
    const ip = clientIp(req);
    const rl = await consumeAuthRateLimit(`magic:ip:${ip}`, 20, 60 * 60 * 1000);
    if (!rl.allowed) {
      return Response.redirect(new URL("/login?error=RateLimit", req.url), 303);
    }
  }
  return handlers.POST(req);
}
