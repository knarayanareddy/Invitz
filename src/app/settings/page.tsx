import { eq } from "drizzle-orm";
import Link from "next/link";
import { deleteAccount, signOutEverywhere } from "@/app/actions/auth";
import { addChannel, removeChannel, resendCode, saveInterests, updateChannel, updateProfile, verifyChannel } from "@/app/actions/settings";
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
    db.select({ topicId: userInterests.topicId }).from(userInterests).where(eq(userInterests.userId, user.id)),
    db.select().from(notificationChannels).where(eq(notificationChannels.userId, user.id)),
    listActiveSessions(user.id),
  ]);
  const myTopicIds = new Set(myInterests.map((i) => i.topicId));
  const input = "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        {welcome && (
          <p className="mt-2 rounded-lg bg-violet-50 px-4 py-3 text-sm text-violet-900">
            Welcome to Invitz!{" "}
            <Link href="/onboarding" className="font-medium underline">
              Run the quick onboarding checklist
            </Link>{" "}
            or configure your profile and notification channels below.
          </p>
        )}
        {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
        {ok && <p className="mt-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">{ok}</p>}
      </div>

      {/* Profile */}
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Profile</h2>
        <form action={updateProfile} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="displayName">Display name</label>
              <input id="displayName" name="displayName" defaultValue={user.displayName} required maxLength={60} className={input} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="handle">Handle <span className="font-normal text-stone-500">(1 change / 30 days)</span></label>
              <input id="handle" name="handle" defaultValue={user.handle} required minLength={3} maxLength={20} pattern="[a-z0-9_]+" className={input} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="headline">Headline</label>
            <input id="headline" name="headline" defaultValue={user.headline} maxLength={100} placeholder="e.g. ML engineer · MLOps nerd" className={input} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="image">Avatar URL <span className="font-normal text-stone-500">(https://, optional)</span></label>
            <input id="image" name="image" type="url" defaultValue={user.image ?? ""} maxLength={500} placeholder="https://example.com/avatar.png" className={input} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="bio">Bio</label>
            <textarea id="bio" name="bio" defaultValue={user.bio} rows={2} maxLength={400} className={input} />
          </div>
          <button className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">Save profile</button>
        </form>
      </section>

      {/* Interests -> auto-joined topic communities */}
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Interests</h2>
        <p className="mt-1 text-sm text-stone-600">Picking an interest automatically joins its topic community.</p>
        <form action={saveInterests} className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {allTopics.map((t) => (
              <label key={t.id} className="cursor-pointer">
                <input type="checkbox" name="topic" value={t.id} defaultChecked={myTopicIds.has(t.id)} className="peer sr-only" />
                <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 px-3 py-1.5 text-sm peer-checked:border-violet-600 peer-checked:bg-violet-600 peer-checked:text-white">
                  {t.emoji} {t.name}
                </span>
              </label>
            ))}
          </div>
          <button className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">Save interests</button>
        </form>
      </section>

      {/* Notification channels */}
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Where we notify you</h2>
        <p className="mt-1 text-sm text-stone-600">
          Connect Discord, WhatsApp, or Signal to get instant pings. By default only <strong>Verified</strong> invites are pushed; unverified (&ldquo;proceed with caution&rdquo;) links stay in-app unless you opt in.
        </p>

        {channels.length > 0 && (
          <ul className="mt-4 space-y-3">
            {channels.map((c) => {
              const adapter = getAdapter(c.type);
              if (!adapter) return null;
              return (
                <li key={c.id} className="rounded-xl border border-stone-200 p-4 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {adapter.label}{" "}
                        {c.verified ? (
                          c.verifiedDryRun && adapter.configured() ? (
                            <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">dry-run only · re-verify for live</span>
                          ) : (
                            <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">verified</span>
                          )
                        ) : (
                          <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">needs verification</span>
                        )}
                      </p>
                      <p className="truncate text-stone-500">{c.type === "discord" ? `${c.destination.slice(0, 38)}…` : c.destination}</p>
                    </div>
                    <form action={removeChannel}>
                      <input type="hidden" name="channelId" value={c.id} />
                      <button className="text-xs text-rose-600 hover:underline">Remove</button>
                    </form>
                  </div>

                  {!c.verified || (c.verifiedDryRun && adapter.configured()) ? (
                    <div className="mt-3 space-y-2">
                      {!adapter.configured() && c.verifyCode && (
                        <p className="rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-700">
                          Dry-run mode ({adapter.label} isn’t configured on this server): your test code is <b className="font-mono">{c.verifyCode}</b>
                        </p>
                      )}
                      <form action={verifyChannel} className="flex gap-2">
                        <input type="hidden" name="channelId" value={c.id} />
                        <input name="code" aria-label="6-digit verification code" inputMode="numeric" maxLength={6} placeholder="6-digit code" className={`${input} max-w-40`} />
                        <button className="rounded-lg bg-stone-900 px-3 py-2 text-white">Verify</button>
                      </form>
                      <form action={resendCode}>
                        <input type="hidden" name="channelId" value={c.id} />
                        <button className="text-xs text-violet-700 hover:underline">Resend code</button>
                      </form>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <form action={updateChannel}>
                        <input type="hidden" name="channelId" value={c.id} />
                        <input type="hidden" name="field" value="enabled" />
                        <input type="hidden" name="value" value={String(!c.enabled)} />
                        <button className="rounded-lg border border-stone-300 px-3 py-1 text-xs hover:bg-stone-50">
                          {c.enabled ? "Pause notifications" : "Resume notifications"}
                        </button>
                      </form>
                      <form action={updateChannel}>
                        <input type="hidden" name="channelId" value={c.id} />
                        <input type="hidden" name="field" value="includeUnverified" />
                        <input type="hidden" name="value" value={String(!c.includeUnverified)} />
                        <button className="rounded-lg border border-stone-300 px-3 py-1 text-xs hover:bg-stone-50">
                          {c.includeUnverified ? "Also pushing unverified · click for Verified only" : "Verified only · click to include unverified"}
                        </button>
                      </form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form action={addChannel} className="mt-4 grid gap-2 sm:grid-cols-[140px_1fr_auto]">
          <select name="type" aria-label="Channel type" className={input}>
            {Object.values(ADAPTERS).map((a) => (
              <option key={a.type} value={a.type}>{a.label}</option>
            ))}
          </select>
          <input name="destination" aria-label="Channel destination" required placeholder="Discord webhook URL or +14155550123" className={input} />
          <button className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">Add</button>
        </form>
      </section>

      {/* Sessions & account lifecycle */}
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Sessions &amp; account</h2>
        <p className="mt-1 text-sm text-stone-600">
          You currently have <strong>{activeSessions.length}</strong> active session{activeSessions.length === 1 ? "" : "s"}.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <form action={signOutEverywhere}>
            <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-50">
              Sign out everywhere
            </button>
          </form>
          <a
            href="/api/account/export"
            download="invitz-export.json"
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-50"
          >
            Export my data (JSON)
          </a>
        </div>

        <form action={deleteAccount} className="mt-6 border-t border-stone-200 pt-4">
          <p className="text-sm font-medium text-rose-700">Delete account</p>
          <p className="mt-1 text-xs text-stone-600">
            Permanently removes your profile, sessions, follows, channels, and shared invites. Type <code>DELETE</code> to confirm.
          </p>
          <div className="mt-2 flex gap-2">
            <input name="confirm" aria-label="Type DELETE to confirm account deletion" required pattern="DELETE" placeholder="DELETE" className={`${input} max-w-40`} />
            <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">
              Delete account
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
