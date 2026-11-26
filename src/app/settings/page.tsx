import { eq } from "drizzle-orm";
import Link from "next/link";
import { deleteAccount, signOutEverywhere } from "@/app/actions/auth";
import {
  addChannel,
  removeChannel,
  resendCode,
  saveInterests,
  updateChannel,
  updateProfile,
  verifyChannel,
} from "@/app/actions/settings";
import { Avatar } from "@/components/invite-card";
import { db } from "@/db";
import { notificationChannels, topics, userInterests } from "@/db/schema";
import { listActiveSessions, requireUser } from "@/lib/auth";
import { ADAPTERS, getAdapter } from "@/lib/notify/adapters";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; welcome?: string }>;
}) {
  const user = await requireUser("/settings");
  const { error, ok, welcome } = await searchParams;
  const [allTopics, myInterests, channels, activeSessions] = await Promise.all([
    db.select().from(topics).orderBy(topics.name),
    db
      .select({ topicId: userInterests.topicId })
      .from(userInterests)
      .where(eq(userInterests.userId, user.id)),
    db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.userId, user.id)),
    listActiveSessions(user.id),
  ]);
  const myTopicIds = new Set(myInterests.map((i) => i.topicId));
  const inputCls = "inv-input w-full px-3.5 py-2 text-sm";

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-3 border-b border-[var(--inv-border)] pb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="inv-kicker">Account &amp; Preferences</span>
            <h1 className="inv-heading mt-0.5 text-3xl font-bold">Settings</h1>
          </div>
          <Link
            href={`/people/${user.handle}`}
            className="inv-btn-secondary px-4 py-1.5 text-xs"
          >
            View public profile →
          </Link>
        </div>

        {welcome && (
          <div className="inv-chip-accent p-4 text-sm">
            Welcome to Invitz!{" "}
            <Link href="/onboarding" className="font-semibold underline">
              Run the quick onboarding checklist
            </Link>{" "}
            or configure your profile and notification channels below.
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="inv-verdict-rejected px-4 py-3 text-sm font-medium"
            style={{ borderRadius: "var(--inv-radius-input)" }}
          >
            {error}
          </p>
        )}
        {ok && (
          <p
            role="status"
            className="inv-verdict-verified px-4 py-3 text-sm font-medium"
            style={{ borderRadius: "var(--inv-radius-input)" }}
          >
            ✓ {ok}
          </p>
        )}
      </div>

      {/* 1. Profile */}
      <section className="inv-card p-6 sm:p-7">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--inv-border)] pb-4">
          <div>
            <span className="inv-kicker">Identity</span>
            <h2 className="inv-heading text-xl font-bold">Profile</h2>
          </div>
          <Avatar name={user.displayName} image={user.image} size={44} />
        </div>

        <form action={updateProfile} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold inv-text-secondary" htmlFor="displayName">
                Display name
              </label>
              <input
                id="displayName"
                name="displayName"
                defaultValue={user.displayName}
                required
                maxLength={60}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold inv-text-secondary" htmlFor="handle">
                Handle <span className="font-normal inv-text-muted">(1 change / 30 days)</span>
              </label>
              <input
                id="handle"
                name="handle"
                defaultValue={user.handle}
                required
                minLength={3}
                maxLength={20}
                pattern="[a-z0-9_]+"
                className={`${inputCls} inv-mono`}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold inv-text-secondary" htmlFor="headline">
              Headline
            </label>
            <input
              id="headline"
              name="headline"
              defaultValue={user.headline}
              maxLength={100}
              placeholder="e.g. ML engineer · MLOps nerd"
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold inv-text-secondary" htmlFor="image">
              Avatar URL <span className="font-normal inv-text-muted">(https://, optional)</span>
            </label>
            <input
              id="image"
              name="image"
              type="url"
              defaultValue={user.image ?? ""}
              maxLength={500}
              placeholder="https://example.com/avatar.png"
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold inv-text-secondary" htmlFor="bio">
              Bio
            </label>
            <textarea
              id="bio"
              name="bio"
              defaultValue={user.bio}
              rows={2}
              maxLength={400}
              className={inputCls}
            />
          </div>

          <div className="flex justify-end pt-1">
            <button type="submit" className="inv-btn-primary px-5 py-2 text-sm">
              Save profile
            </button>
          </div>
        </form>
      </section>

      {/* 2. Interests -> auto-joined topic communities */}
      <section className="inv-card p-6 sm:p-7">
        <div className="border-b border-[var(--inv-border)] pb-3">
          <span className="inv-kicker">Topic Subscriptions</span>
          <h2 className="inv-heading text-xl font-bold">Interests</h2>
          <p className="inv-text-secondary mt-1 text-sm">
            Picking an interest automatically joins its topic community.
          </p>
        </div>

        <form action={saveInterests} className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {allTopics.map((t) => (
              <label key={t.id} className="cursor-pointer">
                <input
                  type="checkbox"
                  name="topic"
                  value={t.id}
                  defaultChecked={myTopicIds.has(t.id)}
                  className="peer sr-only"
                />
                <span className="inv-chip inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium peer-checked:border-[var(--inv-accent)] peer-checked:bg-[var(--inv-accent)] peer-checked:text-[var(--inv-accent-contrast)]">
                  <span>{t.emoji}</span>
                  <span>{t.name}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex justify-end pt-1">
            <button type="submit" className="inv-btn-primary px-5 py-2 text-sm">
              Save interests
            </button>
          </div>
        </form>
      </section>

      {/* 3. Notification channels */}
      <section className="inv-card p-6 sm:p-7">
        <div className="border-b border-[var(--inv-border)] pb-3">
          <span className="inv-kicker">Multi-channel Dispatch</span>
          <h2 className="inv-heading text-xl font-bold">Where we notify you</h2>
          <p className="inv-text-secondary mt-1 text-sm">
            Connect Discord, WhatsApp, or Signal to get instant pings. By default only{" "}
            <strong>Verified</strong> invites are pushed; unverified (&ldquo;proceed with
            caution&rdquo;) links stay in-app unless you opt in.
          </p>
        </div>

        {channels.length > 0 && (
          <ul className="mt-5 space-y-3">
            {channels.map((c) => {
              const adapter = getAdapter(c.type);
              if (!adapter) return null;
              return (
                <li key={c.id} className="inv-surface-subtle p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-bold">
                        <span>{adapter.label}</span>
                        {c.verified ? (
                          c.verifiedDryRun && adapter.configured() ? (
                            <span className="inv-verdict-caution px-2.5 py-0.5 text-xs font-semibold">
                              dry-run only · re-verify for live
                            </span>
                          ) : (
                            <span className="inv-verdict-verified px-2.5 py-0.5 text-xs font-semibold">
                              ✓ verified
                            </span>
                          )
                        ) : (
                          <span className="inv-verdict-caution px-2.5 py-0.5 text-xs font-semibold">
                            needs verification
                          </span>
                        )}
                      </p>
                      <p className="inv-mono mt-0.5 truncate text-xs inv-text-muted">
                        {c.type === "discord" ? `${c.destination.slice(0, 38)}…` : c.destination}
                      </p>
                    </div>
                    <form action={removeChannel}>
                      <input type="hidden" name="channelId" value={c.id} />
                      <button
                        type="submit"
                        className="text-xs font-semibold text-[var(--inv-blocked-text)] hover:underline"
                      >
                        Remove
                      </button>
                    </form>
                  </div>

                  {!c.verified || (c.verifiedDryRun && adapter.configured()) ? (
                    <div className="mt-3 space-y-2.5 border-t border-[var(--inv-border)] pt-3">
                      {!adapter.configured() && c.verifyCode && (
                        <p className="inv-card px-3.5 py-2 text-xs inv-text-secondary">
                          Dry-run mode ({adapter.label} isn’t configured on this server): your test
                          code is <b className="inv-mono">{c.verifyCode}</b>
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-3">
                        <form action={verifyChannel} className="flex items-center gap-2">
                          <input type="hidden" name="channelId" value={c.id} />
                          <input
                            name="code"
                            aria-label="6-digit verification code"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="6-digit code"
                            className={`${inputCls} inv-mono max-w-40`}
                          />
                          <button type="submit" className="inv-btn-ink px-4 py-2 text-xs">
                            Verify
                          </button>
                        </form>
                        <form action={resendCode}>
                          <input type="hidden" name="channelId" value={c.id} />
                          <button type="submit" className="text-xs font-semibold underline inv-text-secondary">
                            Resend code
                          </button>
                        </form>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--inv-border)] pt-3">
                      <form action={updateChannel}>
                        <input type="hidden" name="channelId" value={c.id} />
                        <input type="hidden" name="field" value="enabled" />
                        <input type="hidden" name="value" value={String(!c.enabled)} />
                        <button type="submit" className="inv-btn-secondary px-3.5 py-1.5 text-xs">
                          {c.enabled ? "Pause notifications" : "Resume notifications"}
                        </button>
                      </form>
                      <form action={updateChannel}>
                        <input type="hidden" name="channelId" value={c.id} />
                        <input type="hidden" name="field" value="includeUnverified" />
                        <input type="hidden" name="value" value={String(!c.includeUnverified)} />
                        <button type="submit" className="inv-btn-secondary px-3.5 py-1.5 text-xs">
                          {c.includeUnverified
                            ? "Also pushing unverified · click for Verified only"
                            : "Verified only · click to include unverified"}
                        </button>
                      </form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form action={addChannel} className="mt-5 grid gap-2.5 sm:grid-cols-[150px_1fr_auto]">
          <select name="type" aria-label="Channel type" className={inputCls}>
            {Object.values(ADAPTERS).map((a) => (
              <option key={a.type} value={a.type}>
                {a.label}
              </option>
            ))}
          </select>
          <input
            name="destination"
            aria-label="Channel destination"
            required
            placeholder="Discord webhook URL or +14155550123"
            className={inputCls}
          />
          <button type="submit" className="inv-btn-primary px-5 py-2 text-sm">
            Add
          </button>
        </form>
      </section>

      {/* 4. Sessions & account lifecycle */}
      <section className="inv-card p-6 sm:p-7">
        <div className="border-b border-[var(--inv-border)] pb-3">
          <span className="inv-kicker">Security &amp; Portability</span>
          <h2 className="inv-heading text-xl font-bold">Sessions &amp; account</h2>
          <p className="inv-text-secondary mt-1 text-sm">
            You currently have <strong className="inv-mono">{activeSessions.length}</strong> active
            session{activeSessions.length === 1 ? "" : "s"}.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <form action={signOutEverywhere}>
            <button type="submit" className="inv-btn-secondary px-4 py-2 text-sm">
              Sign out everywhere
            </button>
          </form>
          <a
            href="/api/account/export"
            download="invitz-export.json"
            className="inv-btn-secondary px-4 py-2 text-sm"
          >
            Export my data (JSON)
          </a>
        </div>

        <form action={deleteAccount} className="mt-6 border-t border-[var(--inv-border)] pt-5">
          <p className="text-sm font-bold text-[var(--inv-blocked-text)]">Delete account</p>
          <p className="inv-text-muted mt-1 text-xs">
            Permanently removes your profile, sessions, follows, channels, and shared invites. Type{" "}
            <code className="inv-mono font-bold">DELETE</code> to confirm.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              name="confirm"
              aria-label="Type DELETE to confirm account deletion"
              required
              pattern="DELETE"
              placeholder="DELETE"
              className={`${inputCls} inv-mono max-w-40`}
            />
            <button type="submit" className="inv-btn-danger px-4 py-2 text-sm">
              Delete account
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
