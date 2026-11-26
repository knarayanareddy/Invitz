"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
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
