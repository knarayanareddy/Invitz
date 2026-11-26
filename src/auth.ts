import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import LinkedIn from "next-auth/providers/linkedin";
import Resend from "next-auth/providers/resend";
import type { Provider } from "next-auth/providers";
import { createInvitzAdapter } from "@/lib/auth-adapter";
import { consumeAuthRateLimit } from "@/lib/rate-limit";

const isProd = process.env.NODE_ENV === "production";
const isPreviewSandbox = process.env.E2B_SANDBOX === "true";

function envPair(a: string, b: string, c?: string, d?: string): { id: string; secret: string } | null {
  const id = process.env[a] || (c ? process.env[c] : undefined);
  const secret = process.env[b] || (d ? process.env[d] : undefined);
  if (id && secret) return { id, secret };
  return null;
}

export function configuredAuthProviders() {
  const resendKey = process.env.RESEND_API_KEY || process.env.AUTH_RESEND_KEY;
  return {
    email: Boolean(resendKey) || !isProd,
    emailLive: Boolean(resendKey),
    google: Boolean(envPair("AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET")),
    github: Boolean(envPair("AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET")),
    linkedin: Boolean(envPair("AUTH_LINKEDIN_ID", "AUTH_LINKEDIN_SECRET", "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET")),
  };
}

function buildProviders(): Provider[] {
  const providers: Provider[] = [];
  const resendKey = process.env.RESEND_API_KEY || process.env.AUTH_RESEND_KEY;

  if (resendKey || !isProd) {
    providers.push(
      Resend({
        apiKey: resendKey || "dev-dry-run",
        from: process.env.EMAIL_FROM || "Invitz <no-reply@invitz.app>",
        maxAge: 600, // 10-minute single-use magic-link token
        async sendVerificationRequest({ identifier, url, provider }) {
          if (!resendKey) {
            if (!isProd) {
              console.info(`[Invitz Auth] Magic sign-in link for ${identifier}: ${url}`);
              return;
            }
            throw new Error("Magic-link e-mail delivery requires RESEND_API_KEY.");
          }
          const { host } = new URL(url);
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: provider.from,
              to: identifier,
              subject: `Sign in to Invitz (${host})`,
              text: `Sign in to Invitz:\n${url}\n\nThis single-use link expires in 10 minutes. If you didn't request this, you can safely ignore this e-mail.`,
              html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px"><h2 style="margin:0 0 12px">Sign in to Invitz</h2><p>Click below to sign in. This single-use link expires in <strong>10 minutes</strong>.</p><p style="margin:24px 0"><a href="${url}" style="background:#7c3aed;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Sign in to Invitz</a></p><p style="font-size:12px;color:#78716c">If you didn't request this e-mail, you can ignore it.</p></div>`,
            }),
          });
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Resend failed (${res.status}): ${body.slice(0, 200)}`);
          }
        },
      }),
    );
  }

  const google = envPair("AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
  if (google) {
    providers.push(
      Google({
        clientId: google.id,
        clientSecret: google.secret,
        allowDangerousEmailAccountLinking: true, // Enforced in signIn callback: profile.email_verified === true
      }),
    );
  }

  const github = envPair("AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET");
  if (github) {
    providers.push(
      GitHub({
        clientId: github.id,
        clientSecret: github.secret,
        allowDangerousEmailAccountLinking: true, // Enforced in signIn callback: verified_email === true
        userinfo: {
          url: "https://api.github.com/user",
          async request({ tokens }: { tokens: { access_token?: string } }) {
            const headers = {
              Authorization: `Bearer ${tokens.access_token}`,
              "User-Agent": "invitz-auth",
            };
            const profile = await fetch("https://api.github.com/user", { headers }).then((r) => r.json());
            const emailsRes = await fetch("https://api.github.com/user/emails", { headers });
            if (emailsRes.ok) {
              const emails = (await emailsRes.json()) as {
                email: string;
                primary: boolean;
                verified: boolean;
              }[];
              const verifiedPrimary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
              if (verifiedPrimary) {
                profile.email = verifiedPrimary.email;
                profile.verified_email = true;
              } else {
                profile.verified_email = false;
              }
            } else {
              profile.verified_email = false;
            }
            return profile;
          },
        },
      }),
    );
  }

  const linkedin = envPair("AUTH_LINKEDIN_ID", "AUTH_LINKEDIN_SECRET", "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET");
  if (linkedin) {
    providers.push(
      LinkedIn({
        clientId: linkedin.id,
        clientSecret: linkedin.secret,
        allowDangerousEmailAccountLinking: true, // Enforced in signIn callback: profile.email_verified === true
      }),
    );
  }

  return providers;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: createInvitzAdapter(),
  providers: buildProviders(),
  secret:
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    (!isProd ? "dev-only-secret-change-me" : undefined),
  trustHost: true,
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60, // 30-day sliding expiry
    updateAge: 24 * 60 * 60,
  },
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: isPreviewSandbox && isProd ? "none" : "lax",
        path: "/",
        secure: isProd,
      },
    },
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/login?verify=1",
    error: "/login",
  },
  callbacks: {
    async signIn({ account, profile, email, user }) {
      // Only link OAuth accounts when the provider guarantees the e-mail address is verified.
      if (account?.provider === "google" || account?.provider === "linkedin") {
        return profile?.email_verified === true;
      }
      if (account?.provider === "github") {
        return (profile as { verified_email?: boolean } | undefined)?.verified_email === true;
      }
      if (email?.verificationRequest && user?.email) {
        const key = `magic:email:${user.email.trim().toLowerCase()}`;
        const rl = await consumeAuthRateLimit(key, 5, 60 * 60 * 1000);
        if (!rl.allowed) return "/login?error=RateLimit";
      }
      return true;
    },
    session({ session, user }) {
      if (session.user && user?.id) {
        session.user.id = user.id;
      }
      return session;
    },
  },
});
