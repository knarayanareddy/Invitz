import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAsDemo, loginWithProvider, requestMagicLink } from "@/app/actions/auth";
import { configuredAuthProviders } from "@/auth";
import { getCurrentUser } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";
import { sanitizeNextPath } from "@/lib/url";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  InvalidEmail: "Enter a valid e-mail address.",
  RateLimit: "Too many sign-in link requests. Please wait an hour and try again.",
  AccessDenied: "Sign-in was denied. Make sure your OAuth account has a verified e-mail address.",
  Verification: "That sign-in link has expired or was already used. Request a new one.",
  OAuthAccountNotLinked: "An account with this e-mail already exists. Sign in with your verified method first.",
  Configuration: "That sign-in provider is not configured on this server.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; verify?: string }>;
}) {
  await ensureBootstrap();
  const { error, next, verify } = await searchParams;
  const safeNext = sanitizeNextPath(next);
  if (await getCurrentUser()) redirect(safeNext);

  const providers = configuredAuthProviders();
  const demoEnabled = process.env.INVITZ_DEMO_SEED === "true";
  const oauthList = [
    providers.google && { id: "google", label: "Continue with Google" },
    providers.github && { id: "github", label: "Continue with GitHub" },
    providers.linkedin && { id: "linkedin", label: "Continue with LinkedIn" },
  ].filter(Boolean) as { id: string; label: string }[];

  const errorMessage = error ? ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again." : null;

  return (
    <div className="mx-auto max-w-md space-y-6 py-4">
      <div className="space-y-1.5 text-center">
        <span className="inv-kicker">Passwordless Authentication</span>
        <h1 className="inv-heading text-3xl font-bold">Sign in to Invitz</h1>
        <p className="inv-text-secondary text-sm">
          Use a single-use e-mail magic link or a verified social account.
        </p>
      </div>

      {demoEnabled && (
        <div className="inv-card space-y-3 border-[var(--inv-accent)] p-6">
          <div>
            <span className="inv-kicker">Preview Demo Access</span>
            <h2 className="inv-heading text-lg font-bold">Try a seeded curator account</h2>
            <p className="inv-text-secondary mt-1 text-xs">
              Explore notification channels, quiet hours, digests, live inbox filters, and delivery logs right away.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { handle: "ada", label: "Ada Okafor", role: "ML · @ada" },
              { handle: "maya", label: "Maya Lindqvist", role: "Climate · @maya" },
              { handle: "linus", label: "Linus Park", role: "VCs · @linus" },
              { handle: "grace", label: "Grace Mwangi", role: "Data · @grace" },
            ].map((d) => (
              <form key={d.handle} action={loginAsDemo}>
                <input type="hidden" name="handle" value={d.handle} />
                <input type="hidden" name="next" value={safeNext === "/" ? "/settings" : safeNext} />
                <button
                  type="submit"
                  className="inv-btn-secondary flex w-full flex-col items-start px-3.5 py-2.5 text-left"
                >
                  <span className="text-xs font-bold">{d.label}</span>
                  <span className="inv-mono text-[11px] inv-text-muted">{d.role}</span>
                </button>
              </form>
            ))}
          </div>
        </div>
      )}

      {verify === "1" && (
        <div
          role="status"
          className="inv-verdict-verified p-4 text-sm"
          style={{ borderRadius: "var(--inv-radius-card)" }}
        >
          <p className="font-bold">✓ Check your inbox</p>
          <p className="mt-1 opacity-90">
            We sent a single-use sign-in link that expires in 10 minutes.
          </p>
        </div>
      )}

      {errorMessage && (
        <p
          role="alert"
          className="inv-verdict-rejected px-4 py-3 text-sm font-medium"
          style={{ borderRadius: "var(--inv-radius-input)" }}
        >
          {errorMessage}
        </p>
      )}

      {oauthList.length > 0 && (
        <div className="inv-card space-y-2.5 p-6">
          <p className="inv-kicker">Verified OAuth Providers</p>
          {oauthList.map((p) => (
            <form key={p.id} action={loginWithProvider}>
              <input type="hidden" name="provider" value={p.id} />
              <input type="hidden" name="next" value={safeNext} />
              <button
                type="submit"
                className="inv-btn-secondary w-full px-4 py-2.5 text-sm font-semibold"
              >
                {p.label}
              </button>
            </form>
          ))}
        </div>
      )}

      <form action={requestMagicLink} className="inv-card space-y-4 p-6 sm:p-7">
        <input type="hidden" name="next" value={safeNext} />
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-semibold">
            E-mail magic link
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            className="inv-input w-full px-3.5 py-2.5 text-sm"
          />
          <p className="inv-text-muted mt-2 text-xs leading-relaxed">
            {providers.emailLive
              ? "We’ll e-mail a 10-minute single-use sign-in link."
              : providers.email
                ? "Local dev mode: set RESEND_API_KEY for live e-mail delivery (links log to the server console in dev)."
                : "Magic-link delivery is currently unavailable until RESEND_API_KEY is configured."}
          </p>
        </div>
        <button
          type="submit"
          disabled={!providers.email}
          className="inv-btn-primary w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send magic link
        </button>
      </form>

      <p className="inv-text-muted text-center text-xs">
        Every shared invite is inspected by{" "}
        <Link href="/guidelines" className="font-semibold underline hover:text-[var(--inv-ink)]">
          Invitz Quality Control
        </Link>{" "}
        before anyone is notified.
      </p>
    </div>
  );
}
