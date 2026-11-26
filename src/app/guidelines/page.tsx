import Link from "next/link";
import { db } from "@/db";
import { qcGuidelines } from "@/db/schema";
import { aiConfigured } from "@/lib/qc/ai";

export const dynamic = "force-dynamic";

const SEV = {
  block: { label: "Blocks the share", cls: "inv-verdict-rejected" },
  warn: { label: "Adds a caution label", cls: "inv-verdict-caution" },
  info: { label: "Informational", cls: "inv-verdict-verified" },
} as const;

export default async function GuidelinesPage() {
  const rows = await db.select().from(qcGuidelines).orderBy(qcGuidelines.sortOrder);
  const enabled = rows.filter((r) => r.enabled);
  const ai = aiConfigured();

  const ruleCount = enabled.filter((g) => g.scope === "rule").length;
  const aiCount = enabled.filter((g) => g.scope === "ai").length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--inv-border)] pb-4">
        <div>
          <span className="inv-kicker">Published Trust Specification</span>
          <h1 className="inv-heading mt-0.5 text-3xl font-bold">
            How Invitz quality control works
          </h1>
          <p className="inv-text-secondary mt-1.5 text-sm leading-relaxed">
            Every share is checked <i>before</i> anyone is notified. The same published rulebook
            drives both our deterministic safety checks and the AI event reviewer.
          </p>
        </div>
        <div className="inv-mono text-xs inv-text-muted">
          {ruleCount} deterministic · {aiCount} AI checks
        </div>
      </div>

      {/* Three Trust States */}
      <div className="grid gap-3.5 sm:grid-cols-3">
        <div className="inv-verdict-verified p-4 text-sm" style={{ borderRadius: "var(--inv-radius-card)" }}>
          <p className="font-bold">✓ Verified</p>
          <p className="mt-1.5 text-xs leading-relaxed opacity-90">
            Passed every rule and the AI is confident it’s a real event. Pushed to your channels.
          </p>
        </div>
        <div className="inv-verdict-caution p-4 text-sm" style={{ borderRadius: "var(--inv-radius-card)" }}>
          <p className="font-bold">⚠ Proceed with caution</p>
          <p className="mt-1.5 text-xs leading-relaxed opacity-90">
            We couldn’t validate it with confidence. It’s shown with a warning and not pushed unless
            you opt in.
          </p>
        </div>
        <div className="inv-verdict-rejected p-4 text-sm" style={{ borderRadius: "var(--inv-radius-card)" }}>
          <p className="font-bold">✕ Blocked</p>
          <p className="mt-1.5 text-xs leading-relaxed opacity-90">
            Clear policy violation or high-confidence spam. Nobody is notified.
          </p>
        </div>
      </div>

      {/* Live AI Review Status */}
      <div
        className={`p-4 text-sm ${ai ? "inv-verdict-verified" : "inv-verdict-caution"}`}
        style={{ borderRadius: "var(--inv-radius-input)" }}
      >
        <p className="font-semibold">
          {ai
            ? "✓ AI review is active on this server."
            : "AI review is NOT configured on this server (set OPENAI_API_KEY or ANTHROPIC_API_KEY). Until then every link that passes the rules is labelled “proceed with caution”, never “verified”."}
        </p>
      </div>

      {/* Rulebook List */}
      <ul className="space-y-3">
        {enabled.map((g, idx) => (
          <li key={g.key} className="inv-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="inv-mono text-xs font-bold inv-text-muted">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <h2 className="inv-heading text-lg font-bold">{g.title}</h2>
                <span className="inv-mono text-xs inv-text-muted">({g.key})</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inv-chip px-2.5 py-0.5 text-xs font-medium">
                  {g.scope === "ai" ? "AI-reviewed" : "Automatic rule"}
                </span>
                <span className={`px-2.5 py-0.5 text-xs font-semibold ${SEV[g.severity].cls}`}>
                  {SEV[g.severity].label}
                </span>
              </div>
            </div>
            <p className="inv-text-secondary mt-2 text-sm leading-relaxed">{g.description}</p>
          </li>
        ))}
      </ul>

      <div className="inv-surface-subtle flex flex-wrap items-center justify-between gap-3 p-4 text-xs inv-text-muted">
        <p>
          No system is perfect. If a good invite was blocked, or a bad one slipped through, use the
          Report button on the invite.
        </p>
        <Link href="/share" className="inv-btn-secondary px-3.5 py-1.5 text-xs font-semibold">
          Share an event →
        </Link>
      </div>
    </div>
  );
}
