import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { reportInvite } from "@/app/actions/invites";
import { db } from "@/db";
import { qcChecks, reports } from "@/db/schema";
import { InviteCard } from "@/components/invite-card";
import { getCurrentUser } from "@/lib/auth";
import { getFeed } from "@/lib/queries";

import { isUuid } from "@/lib/url";

export const dynamic = "force-dynamic";

const SEV = {
  block: { label: "Blocking", cls: "bg-rose-100 text-rose-700" },
  warn: { label: "Caution", cls: "bg-amber-100 text-amber-800" },
  info: { label: "Note", cls: "bg-emerald-100 text-emerald-700" },
} as const;

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

  const [qc] = await db.select().from(qcChecks).where(eq(qcChecks.inviteId, id)).orderBy(desc(qcChecks.createdAt)).limit(1);
  const alreadyReported = user
    ? (await db.select({ id: reports.id }).from(reports).where(and(eq(reports.inviteId, id), eq(reports.reporterId, user.id))).limit(1)).length > 0
    : false;
  const isOwner = user?.id === invite.sharer.id;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/" className="text-sm text-stone-500 hover:text-stone-800">← Back to feed</Link>

      {invite.status === "blocked" && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-semibold">This invite was blocked and was not shared with anyone.</p>
          <p className="mt-1">{invite.summary}</p>
          <p className="mt-2 text-rose-700">Fix the issues below and share again, or contact support if you think this is a mistake.</p>
        </div>
      )}
      {invite.status === "flagged" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Several members reported this invite. It’s hidden from feeds while a moderator reviews it.
        </div>
      )}
      {reported && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">Thanks, your report was recorded.</p>}

      <InviteCard invite={invite} detailed />

      {qc && (
        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Quality-check report</h2>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
              <div
                className={`h-full ${qc.verdict === "verified" ? "bg-emerald-500" : qc.verdict === "caution" ? "bg-amber-500" : "bg-rose-500"}`}
                style={{ width: `${Math.round(qc.confidence * 100)}%` }}
              />
            </div>
            <span className="text-sm tabular-nums text-stone-600">{Math.round(qc.confidence * 100)}% confidence</span>
          </div>
          {qc.verdict !== "caution" && <p className="mt-3 text-sm text-stone-700">{invite.summary}</p>}
          {qc.findings.length > 0 && (
            <ul className="mt-4 space-y-2">
              {qc.findings.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${SEV[f.severity].cls}`}>{SEV[f.severity].label}</span>
                  <span className="text-stone-700">{f.message}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-stone-500">
            Checked by {qc.provider}
            {qc.model ? ` (${qc.model})` : ""} · {qc.pageFetched ? "page fetched" : "page not fetched"} · {qc.durationMs} ms ·{" "}
            <Link href="/guidelines" className="underline">see the rules</Link>
          </p>
        </section>
      )}

      {user && !isOwner && invite.status === "published" && (
        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Something wrong?</h2>
          {alreadyReported ? (
            <p className="mt-2 text-sm text-stone-600">You’ve already reported this invite.</p>
          ) : (
            <form action={reportInvite} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="inviteId" value={invite.id} />
              <select name="reason" aria-label="Report reason" className="rounded-lg border border-stone-300 px-3 py-2 text-sm">
                <option value="spam">Spam</option>
                <option value="scam">Scam / phishing</option>
                <option value="misleading">Misleading details</option>
                <option value="inappropriate">Inappropriate</option>
              </select>
              <input name="details" aria-label="Report details" placeholder="Details (optional)" className="min-w-48 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm" />
              <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-50">Report</button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
