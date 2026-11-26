import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { reportInvite } from "@/app/actions/invites";
import { InviteCard } from "@/components/invite-card";
import { VerdictBadge } from "@/components/verdict";
import { db } from "@/db";
import { qcChecks, reports } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getFeed } from "@/lib/queries";
import { isUuid } from "@/lib/url";

export const dynamic = "force-dynamic";

const SEV = {
  block: { label: "Blocking", cls: "inv-verdict-rejected" },
  warn: { label: "Caution", cls: "inv-verdict-caution" },
  info: { label: "Signal", cls: "inv-verdict-verified" },
} as const;

const SOURCE_LABELS: Record<string, string> = {
  rule: "Deterministic Rule",
  page: "Page Metadata",
  ai: "AI Reviewer",
};

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reported?: string }>;
}) {
  const { id } = await params;
  const { reported } = await searchParams;
  if (!isUuid(id)) notFound();
  const user = await getCurrentUser();
  const [invite] = await getFeed({ viewerId: user?.id ?? null, inviteId: id, limit: 1 });
  if (!invite) notFound();

  const [qc] = await db
    .select()
    .from(qcChecks)
    .where(eq(qcChecks.inviteId, id))
    .orderBy(desc(qcChecks.createdAt))
    .limit(1);

  const alreadyReported = user
    ? (
        await db
          .select({ id: reports.id })
          .from(reports)
          .where(and(eq(reports.inviteId, id), eq(reports.reporterId, user.id)))
          .limit(1)
      ).length > 0
    : false;
  const isOwner = user?.id === invite.sharer.id;

  const pct = qc ? Math.round(qc.confidence * 100) : Math.round(invite.confidence * 100);
  const barColor =
    (qc?.verdict ?? invite.verdict) === "verified"
      ? "var(--inv-verified-bar)"
      : (qc?.verdict ?? invite.verdict) === "caution"
        ? "var(--inv-caution-bar)"
        : "var(--inv-blocked-bar)";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/"
          className="inv-btn-secondary px-3.5 py-1.5 text-xs font-medium"
        >
          ← Back to feed
        </Link>
        <span className="inv-kicker">Invite &amp; QC Audit Trail</span>
      </div>

      {invite.status === "blocked" && (
        <div
          role="alert"
          className="inv-verdict-rejected p-4 text-sm"
          style={{ borderRadius: "var(--inv-radius-card)" }}
        >
          <p className="font-bold">This invite was blocked and was not shared with anyone.</p>
          <p className="mt-1 opacity-90">{invite.summary}</p>
          <p className="mt-2 text-xs opacity-80">
            Fix the issues below and share again, or contact support if you think this is a mistake.
          </p>
        </div>
      )}

      {invite.status === "flagged" && (
        <div
          role="status"
          className="inv-verdict-caution p-4 text-sm"
          style={{ borderRadius: "var(--inv-radius-card)" }}
        >
          Several members reported this invite. It’s hidden from feeds while a moderator reviews it.
        </div>
      )}

      {reported && (
        <p
          role="status"
          className="inv-verdict-verified px-4 py-3 text-sm font-medium"
          style={{ borderRadius: "var(--inv-radius-input)" }}
        >
          ✓ Thanks, your report was recorded.
        </p>
      )}

      <InviteCard invite={invite} detailed />

      {/* Crisp Trust & Quality-Check Inspector */}
      {qc && (
        <section className="inv-card overflow-hidden p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--inv-border)] pb-4">
            <div>
              <span className="inv-kicker">Automated Trust Verification</span>
              <h2 className="inv-heading mt-0.5 text-xl font-bold">
                Quality-check report
              </h2>
            </div>
            <VerdictBadge verdict={qc.verdict} confidence={qc.confidence} />
          </div>

          {/* Confidence Meter */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold inv-text-secondary">
                Verification confidence score
              </span>
              <span className="inv-mono text-sm font-bold">
                {pct}% confidence
              </span>
            </div>
            <div className="inv-surface-subtle h-2.5 w-full overflow-hidden rounded-full p-0.5">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: barColor }}
              />
            </div>
            {qc.verdict !== "caution" && (
              <p className="pt-1 text-sm inv-text-secondary">{invite.summary}</p>
            )}
          </div>

          {/* Structured Findings List */}
          <div className="mt-5 space-y-2.5">
            <p className="inv-kicker">
              Inspection Findings ({qc.findings.length})
            </p>
            {qc.findings.length === 0 ? (
              <p className="inv-surface-subtle p-3 text-xs inv-text-muted">
                No warnings or blocking issues recorded during inspection.
              </p>
            ) : (
              <ul className="space-y-2">
                {qc.findings.map((f, i) => (
                  <li
                    key={i}
                    className="inv-surface-subtle flex flex-wrap items-start justify-between gap-3 p-3.5 text-sm"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-2.5">
                      <span
                        className={`mt-0.5 shrink-0 px-2.5 py-0.5 text-[11px] font-semibold ${SEV[f.severity].cls}`}
                      >
                        {SEV[f.severity].label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-[var(--inv-ink)]">{f.message}</p>
                        <p className="inv-mono mt-0.5 text-[11px] inv-text-muted">
                          check: {f.code} · stage: {SOURCE_LABELS[f.source] ?? f.source}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Provenance & Telemetry Footer */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--inv-border)] pt-3.5 text-xs inv-text-muted">
            <div className="inv-mono flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                Checked by <strong>{qc.provider}</strong>
                {qc.model ? ` (${qc.model})` : ""}
              </span>
              <span>·</span>
              <span>{qc.pageFetched ? "page fetched" : "page not fetched"}</span>
              <span>·</span>
              <span>{qc.durationMs} ms</span>
            </div>
            <Link href="/guidelines" className="font-semibold underline hover:text-[var(--inv-ink)]">
              See the QC rulebook →
            </Link>
          </div>
        </section>
      )}

      {/* Moderation / Report Panel */}
      {user && !isOwner && invite.status === "published" && (
        <section className="inv-card p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="inv-kicker">Community Safeguard</span>
              <h2 className="inv-heading mt-0.5 text-lg font-bold">
                Something wrong with this invite?
              </h2>
            </div>
          </div>

          {alreadyReported ? (
            <p className="inv-text-muted mt-2 text-sm">
              You’ve already reported this invite. Moderators review invites that receive multiple community reports.
            </p>
          ) : (
            <form action={reportInvite} className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="inviteId" value={invite.id} />
              <div className="space-y-1">
                <label htmlFor="report-reason" className="block text-xs font-medium inv-text-secondary">
                  Reason
                </label>
                <select
                  id="report-reason"
                  name="reason"
                  aria-label="Report reason"
                  className="inv-input px-3 py-2 text-sm"
                >
                  <option value="spam">Spam</option>
                  <option value="scam">Scam / phishing</option>
                  <option value="misleading">Misleading details</option>
                  <option value="inappropriate">Inappropriate</option>
                </select>
              </div>
              <div className="min-w-52 flex-1 space-y-1">
                <label htmlFor="report-details" className="block text-xs font-medium inv-text-secondary">
                  Additional context <span className="inv-text-muted">(optional)</span>
                </label>
                <input
                  id="report-details"
                  name="details"
                  aria-label="Report details"
                  placeholder="Details (optional)"
                  className="inv-input w-full px-3 py-2 text-sm"
                />
              </div>
              <button type="submit" className="inv-btn-secondary px-4 py-2 text-sm">
                Report
              </button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
