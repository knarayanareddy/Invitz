import { and, desc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { markAllRead } from "@/app/actions/social";
import { EmptyState } from "@/components/invite-card";
import { VerdictBadge } from "@/components/verdict";
import { db } from "@/db";
import { events, invites, notifications } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireUser();
  const base = db
    .select({
      id: notifications.id,
      reason: notifications.reason,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      status: notifications.status,
      channel: notifications.channel,
      error: notifications.error,
      inviteId: invites.id,
      verdict: invites.verdict,
      confidence: invites.confidence,
      title: events.title,
    })
    .from(notifications)
    .innerJoin(invites, eq(invites.id, notifications.inviteId))
    .innerJoin(events, eq(events.id, invites.eventId));

  const inApp = await base
    .where(and(eq(notifications.userId, user.id), eq(notifications.channel, "in_app")))
    .orderBy(desc(notifications.createdAt))
    .limit(50);

  const external = await base
    .where(and(eq(notifications.userId, user.id), ne(notifications.channel, "in_app")))
    .orderBy(desc(notifications.createdAt))
    .limit(10);

  const unreadItems = inApp.filter((n) => !n.readAt).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--inv-border)] pb-4">
        <div>
          <span className="inv-kicker">Alert Inbox &amp; Delivery Log</span>
          <h1 className="inv-heading mt-0.5 text-3xl font-bold">Notifications</h1>
          <p className="inv-text-secondary mt-1 text-sm">
            In-app dispatches and verified external channel pushes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/settings" className="inv-btn-secondary px-3.5 py-1.5 text-xs">
            Configure channels
          </Link>
          {inApp.length > 0 && (
            <form action={markAllRead}>
              <button
                type="submit"
                className="inv-btn-primary px-4 py-1.5 text-xs"
              >
                Mark all read {unreadItems > 0 ? `(${unreadItems})` : ""}
              </button>
            </form>
          )}
        </div>
      </div>

      {inApp.length === 0 ? (
        <EmptyState
          title="You're all caught up"
          hint="Join communities or follow curators to get notified when new events pass quality control."
        >
          <div className="flex flex-wrap gap-2">
            <Link href="/groups" className="inv-btn-primary px-4 py-2 text-sm">
              Browse communities
            </Link>
            <Link href="/people" className="inv-btn-secondary px-4 py-2 text-sm">
              Find curators
            </Link>
          </div>
        </EmptyState>
      ) : (
        <ul className="space-y-2.5">
          {inApp.map((n) => {
            const isUnread = !n.readAt;
            return (
              <li key={n.id}>
                <Link
                  href={`/invites/${n.inviteId}`}
                  className={`inv-card inv-card-interactive flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5 ${
                    isUnread ? "border-[var(--inv-accent)]" : ""
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                        isUnread ? "bg-[var(--inv-accent)]" : "bg-[var(--inv-border-strong)]"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-[var(--inv-ink)]">{n.title}</p>
                      <p className="inv-text-muted mt-0.5 text-xs sm:text-sm">
                        {n.reason} · <span className="inv-mono">{timeAgo(n.createdAt)}</span>
                      </p>
                    </div>
                  </div>
                  <VerdictBadge verdict={n.verdict} confidence={n.confidence} compact />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {external.length > 0 && (
        <section className="inv-card p-5 sm:p-6">
          <div className="flex items-center justify-between border-b border-[var(--inv-border)] pb-3">
            <div>
              <span className="inv-kicker">External Pushes</span>
              <h2 className="inv-heading text-lg font-bold">Recent external deliveries</h2>
            </div>
            <span className="inv-mono text-xs inv-text-muted">Discord · WhatsApp · Signal</span>
          </div>
          <ul className="mt-3 divide-y divide-[var(--inv-border)] text-sm">
            {external.map((n) => {
              const statusCls =
                n.status === "failed"
                  ? "inv-verdict-rejected"
                  : n.status === "dry_run"
                    ? "inv-verdict-caution"
                    : "inv-verdict-verified";
              return (
                <li
                  key={n.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <span className="truncate font-medium">{n.title}</span>
                  <span className="inv-mono flex shrink-0 items-center gap-2 text-xs">
                    <span className="inv-chip px-2.5 py-0.5 uppercase">{n.channel}</span>
                    <span className={`px-2.5 py-0.5 font-semibold ${statusCls}`}>
                      {n.status}
                    </span>
                    {n.error && <span className="inv-text-muted">({n.error})</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
