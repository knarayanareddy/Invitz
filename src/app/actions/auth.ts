"use server";

import { randomBytes } from "node:crypto";
import { and, eq, ilike } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { requireUser, revokeAllSessions } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";
import { consumeAuthRateLimit } from "@/lib/rate-limit";
import { sanitizeNextPath } from "@/lib/url";

const ALLOWED_OAUTH = new Set(["google", "github", "linkedin"]);

async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return h.get("x-real-ip")?.trim() || "unknown";
}

export async function requestMagicLink(formData: FormData) {
  await ensureBootstrap();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const safeNext = sanitizeNextPath(String(formData.get("next") ?? ""));

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const q = new URLSearchParams({ error: "InvalidEmail" });
    if (safeNext !== "/") q.set("next", safeNext);
    redirect(`/login?${q.toString()}`);
  }

  const ip = await clientIp();
  const ipRl = await consumeAuthRateLimit(`magic:ip:${ip}`, 20, 60 * 60 * 1000);
  if (!ipRl.allowed) {
    const q = new URLSearchParams({ error: "RateLimit" });
    if (safeNext !== "/") q.set("next", safeNext);
    redirect(`/login?${q.toString()}`);
  }

  try {
    await signIn("resend", { email, redirectTo: safeNext });
  } catch (err) {
    if (err instanceof AuthError) {
      const q = new URLSearchParams({ error: err.type });
      if (safeNext !== "/") q.set("next", safeNext);
      redirect(`/login?${q.toString()}`);
    }
    throw err;
  }
}

export async function loginWithProvider(formData: FormData) {
  await ensureBootstrap();
  const provider = String(formData.get("provider") ?? "");
  const safeNext = sanitizeNextPath(String(formData.get("next") ?? ""));
  if (!ALLOWED_OAUTH.has(provider)) {
    redirect("/login?error=Configuration");
  }

  try {
    await signIn(provider, { redirectTo: safeNext });
  } catch (err) {
    if (err instanceof AuthError) {
      const q = new URLSearchParams({ error: err.type });
      if (safeNext !== "/") q.set("next", safeNext);
      redirect(`/login?${q.toString()}`);
    }
    throw err;
  }
}

export async function loginAsDemo(formData: FormData) {
  if (process.env.INVITZ_DEMO_SEED !== "true") {
    redirect("/login?error=Configuration");
  }
  await ensureBootstrap();
  const handle = String(formData.get("handle") ?? "ada").trim().toLowerCase();
  const safeNext = sanitizeNextPath(String(formData.get("next") ?? "/settings"));

  const [demoUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.handle, handle), ilike(users.email, "%@demo.invitz.app")))
    .limit(1);

  if (!demoUser) {
    redirect("/login?error=AccessDenied");
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ sessionToken: token, userId: demoUser.id, expires });

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "";
  const isHttps = proto.split(",")[0]?.trim() === "https" || process.env.COOKIE_SECURE === "true";
  const isPreview = process.env.E2B_SANDBOX === "true";
  const cookieName = isHttps ? "__Secure-authjs.session-token" : "authjs.session-token";

  const jar = await cookies();
  jar.set(cookieName, token, {
    httpOnly: true,
    sameSite: isPreview && isHttps ? "none" : "lax",
    secure: isHttps,
    path: "/",
    expires,
  });

  redirect(safeNext);
}

export async function logout() {
  await signOut({ redirectTo: "/" });
}

export async function signOutEverywhere() {
  const user = await requireUser("/settings");
  await revokeAllSessions(user.id);
  await signOut({ redirectTo: "/login" });
}

export async function deleteAccount(formData: FormData) {
  const user = await requireUser("/settings");
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (confirm !== "DELETE") {
    redirect(`/settings?error=${encodeURIComponent("Type DELETE to confirm account deletion.")}`);
  }
  await db.delete(users).where(eq(users.id, user.id));
  await signOut({ redirectTo: "/" });
}
