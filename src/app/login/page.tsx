import { redirect } from "next/navigation";
import { loginWithProvider, requestMagicLink } from "@/app/actions/auth";
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
  const oauthList = [
    providers.google && { id: "google", label: "Continue with Google" },
    providers.github && { id: "github", label: "Continue with GitHub" },
    providers.linkedin && { id: "linkedin", label: "Continue with LinkedIn" },
  ].filter(Boolean) as { id: string; label: string }[];

  const errorMessage = error ? ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again." : null;

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sign in to Invitz</h1>
        <p className="mt-1 text-sm text-stone-600">
          Use a single-use e-mail magic link or a verified social account.
        </p>
      </div>

      {verify === "1" && (
        <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200">
          <p className="font-medium">Check your inbox</p>
          <p className="mt-1">We sent a single-use sign-in link that expires in 10 minutes.</p>
        </div>
      )}

      {errorMessage && (
        <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
          {errorMessage}
        </p>
      )}

      {oauthList.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          {oauthList.map((p) => (
            <form key={p.id} action={loginWithProvider}>
              <input type="hidden" name="provider" value={p.id} />
              <input type="hidden" name="next" value={safeNext} />
              <button className="w-full rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-900 hover:bg-stone-50">
                {p.label}
              </button>
            </form>
          ))}
        </div>
      )}

      <form action={requestMagicLink} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <input type="hidden" name="next" value={safeNext} />
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            E-mail magic link
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
          />
          <p className="mt-1 text-xs text-stone-500">
            {providers.emailLive
              ? "We’ll e-mail a 10-minute single-use sign-in link."
              : providers.email
                ? "Local dev mode: set RESEND_API_KEY for live e-mail delivery (links log to the server console in dev)."
                : "Magic-link delivery is currently unavailable until RESEND_API_KEY is configured."}
          </p>
        </div>
        <button
          disabled={!providers.email}
          className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send magic link
        </button>
      </form>
    </div>
  );
}
