import { and, desc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { markAllRead } from "@/app/actions/social";
import { db } from "@/db";
import { events, invites, notifications } from "@/db/schema";
import { EmptyState } from "@/components/invite-card";
import { VerdictBadge } from "@/components/verdict";
import { requireUser } from "@/lib/auth";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireUser();
  const base = db
    .select({
      id: notifications.id, reason: notifications.reason, readAt: notifications.readAt, createdAt: notifications.createdAt,
      status: notifications.status, channel: notifications.channel, error: notifications.error,
      inviteId: invites.id, verdict: invites.verdict, confidence: invites.confidence, title: events.title,
    })
    .from(notifications)
    .innerJoin(invites, eq(invites.id, notifications.inviteId))
    .innerJoin(events, eq(events.id, invites.eventId));

  const inApp = await base.where(and(eq(notifications.userId, user.id), eq(notifications.channel, "in_app"))).orderBy(desc(notifications.createdAt)).limit(50);
  const external = await base.where(and(eq(notifications.userId, user.id), ne(notifications.channel, "in_app"))).orderBy(desc(notifications.createdAt)).limit(10);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <form action={markAllRead}><button className="text-sm text-violet-700 hover:underline">Mark all read</button></form>
      </div>

      {inApp.length === 0 ? (
        <EmptyState title="You're all caught up" hint="Join communities or follow people to get notified about new invites." />
      ) : (
        <ul className="space-y-2">
          {inApp.map((n) => (
            <li key={n.id}>
              <Link href={`/invites/${n.inviteId}`} className={`flex items-center gap-3 rounded-xl border p-4 hover:border-violet-300 ${n.readAt ? "border-stone-200 bg-white" : "border-violet-200 bg-violet-50"}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{n.title}</p>
                  <p className="text-sm text-stone-500">{n.reason} · {timeAgo(n.createdAt)}</p>
                </div>
                <VerdictBadge verdict={n.verdict} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {external.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Recent external deliveries</h2>
          <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white text-sm">
            {external.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="truncate">{n.title}</span>
                <span className="shrink-0 text-xs text-stone-500">
                  {n.channel} · <b className={n.status === "failed" ? "text-rose-600" : n.status === "dry_run" ? "text-amber-700" : "text-emerald-700"}>{n.status}</b>
                  {n.error ? ` (${n.error})` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
