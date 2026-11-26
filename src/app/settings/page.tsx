import { eq } from "drizzle-orm";
import Link from "next/link";
import { deleteAccount, signOutEverywhere } from "@/app/actions/auth";
import {
  removeChannel,
  resendCode,
  saveInterests,
  saveNotificationPreferences,
  updateChannel,
  updateProfile,
  verifyChannel,
} from "@/app/actions/settings";
import { AddChannelForm } from "@/components/add-channel-form";
import { Avatar } from "@/components/invite-card";
import { db } from "@/db";
import { notificationChannels, notificationPreferences, topics, userInterests } from "@/db/schema";
import { listActiveSessions, requireUser } from "@/lib/auth";
import { decryptSecret, maskDestination } from "@/lib/crypto";
import { ADAPTERS, getAdapter } from "@/lib/notify/adapters";
import { WHATSAPP_OPT_IN_CONSENT_TEXT } from "@/lib/notify/dispatch";
import { COMMON_TIMEZONES } from "@/lib/notify/schedule";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; welcome?: string }>;
}) {
  const user = await requireUser("/settings");
  const { error, ok, welcome } = await searchParams;
  const [allTopics, myInterests, channels, activeSessions, prefRows] = await Promise.all([
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
    db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, user.id))
      .limit(1),
  ]);

  const prefs = prefRows[0] ?? {
    userId: user.id,
    timezone: "UTC",
    quietStart: null,
    quietEnd: null,
    dailyCap: 5,
    digestMode: "instant" as const,
    emailFallback: true,
    updatedAt: new Date(),
  };

  const timezoneChoices = COMMON_TIMEZONES.includes(prefs.timezone as (typeof COMMON_TIMEZONES)[number])
    ? [...COMMON_TIMEZONES]
    : [prefs.timezone, ...COMMON_TIMEZONES];

  const myTopicIds = new Set(myInterests.map((i) => i.topicId));
  const inputCls = "inv-input w-full px-3.5 py-2 text-sm";

  const channelOptions = Object.values(ADAPTERS).map((a) => ({
    type: a.type,
    label: a.label,
    placeholder: a.placeholder,
    beta: a.beta,
    consentRequired: a.consentRequired,
    disabledReason: a.disabledReason?.() ?? null,
  }));

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

      {/* 3. Delivery preferences (quiet hours, timezone, daily cap, digests, email fallback) */}
      <section className="inv-card p-6 sm:p-7">
        <div className="border-b border-[var(--inv-border)] pb-3">
          <span className="inv-kicker">Cadence &amp; Quiet Hours</span>
          <h2 className="inv-heading text-xl font-bold">Delivery preferences</h2>
          <p className="inv-text-secondary mt-1 text-sm">
            Follow-bell alerts from curators stay instant; community invites follow your digest setting and pause during quiet hours.
          </p>
        </div>

        <form action={saveNotificationPreferences} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold inv-text-secondary" htmlFor="timezone">
                Time zone
              </label>
              <select id="timezone" name="timezone" defaultValue={prefs.timezone} className={inputCls}>
                {timezoneChoices.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold inv-text-secondary" htmlFor="digestMode">
                Community digest cadence
              </label>
              <select id="digestMode" name="digestMode" defaultValue={prefs.digestMode} className={inputCls}>
                <option value="instant">Instant (send immediately)</option>
                <option value="hourly">Hourly digest</option>
                <option value="daily">Daily digest (09:00 local)</option>
                <option value="weekly">Weekly digest (Mon 09:00 local)</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold inv-text-secondary" htmlFor="quietStart">
                Quiet hours start
              </label>
              <input
                id="quietStart"
                name="quietStart"
                type="time"
                defaultValue={prefs.quietStart ?? ""}
                className={`${inputCls} inv-mono`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold inv-text-secondary" htmlFor="quietEnd">
                Quiet hours end
              </label>
              <input
                id="quietEnd"
                name="quietEnd"
                type="time"
                defaultValue={prefs.quietEnd ?? ""}
                className={`${inputCls} inv-mono`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold inv-text-secondary" htmlFor="dailyCap">
                Daily external cap <span className="font-normal inv-text-muted">(0 = ∞)</span>
              </label>
              <input
                id="dailyCap"
                name="dailyCap"
                type="number"
                min={0}
                max={50}
                defaultValue={prefs.dailyCap}
                className={`${inputCls} inv-mono`}
              />
            </div>
          </div>

          <label className="inv-surface-subtle flex cursor-pointer items-center gap-2.5 p-3 text-sm inv-text-secondary">
            <input type="checkbox" name="emailFallback" value="true" defaultChecked={prefs.emailFallback} />
            <span>
              Enable <strong>e-mail fallback</strong> when Discord, WhatsApp, Telegram, or Signal deliveries fail permanently or reach dead-letter.
            </span>
          </label>

          <div className="flex justify-end pt-1">
            <button type="submit" className="inv-btn-primary px-5 py-2 text-sm">
              Save delivery preferences
            </button>
          </div>
        </form>
      </section>

      {/* 4. Notification channels */}
      <section className="inv-card p-6 sm:p-7">
        <div className="border-b border-[var(--inv-border)] pb-3">
          <span className="inv-kicker">Multi-channel Dispatch</span>
          <h2 className="inv-heading text-xl font-bold">Where we notify you</h2>
          <p className="inv-text-secondary mt-1 text-sm">
            Connect Discord, Telegram, WhatsApp, Signal, or E-mail. Destinations are encrypted at rest, and only{" "}
            <strong>Verified</strong> invites are pushed externally unless you opt in.
          </p>
        </div>

        {channels.length > 0 && (
          <ul className="mt-5 space-y-3">
            {channels.map((c) => {
              const adapter = getAdapter(c.type);
              if (!adapter) return null;
              let displayDest = "[encrypted]";
              try {
                displayDest = maskDestination(c.type, decryptSecret(c.destination));
              } catch {
                displayDest = "[encrypted]";
              }
              return (
                <li key={c.id} className="inv-surface-subtle p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-bold">
                        <span>{adapter.label}</span>
                        {adapter.beta && (
                          <span className="inv-chip px-2 py-0.5 text-[11px] font-semibold uppercase">Beta</span>
                        )}
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
                        {!c.enabled && (
                          <span className="inv-verdict-rejected px-2.5 py-0.5 text-xs font-semibold">
                            paused
                          </span>
                        )}
                      </p>
                      <p className="inv-mono mt-0.5 truncate text-xs inv-text-muted">{displayDest}</p>
                      {c.disabledReason && (
                        <p className="mt-1 text-xs font-medium text-[var(--inv-blocked-text)]">
                          {c.disabledReason}
                        </p>
                      )}
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
                            {c.type === "telegram" ? "Regenerate link / code" : "Resend code"}
                          </button>
                        </form>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--inv-border)] pt-3">
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
                      <form action={updateChannel} className="flex items-center gap-1.5">
                        <input type="hidden" name="channelId" value={c.id} />
                        <input type="hidden" name="field" value="digestMode" />
                        <select
                          name="value"
                          aria-label={`Digest mode for ${adapter.label}`}
                          defaultValue={c.digestMode ?? ""}
                          className="inv-input px-2.5 py-1 text-xs"
                        >
                          <option value="">Default ({prefs.digestMode})</option>
                          <option value="instant">Instant</option>
                          <option value="hourly">Hourly</option>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                        </select>
                        <button type="submit" className="inv-btn-secondary px-2.5 py-1 text-xs">
                          Set
                        </button>
                      </form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <AddChannelForm
          options={channelOptions}
          consentText={WHATSAPP_OPT_IN_CONSENT_TEXT}
          inputCls={inputCls}
        />
      </section>

      {/* 5. Sessions & account lifecycle */}
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
