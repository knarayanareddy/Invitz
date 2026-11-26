import type { Verdict } from "@/db/schema";

const STYLES: Record<Verdict, { label: string; shortLabel: string; cls: string; icon: string }> = {
  verified: {
    label: "Verified",
    shortLabel: "Verified",
    cls: "inv-verdict-verified",
    icon: "✓",
  },
  caution: {
    label: "Unverified · proceed with caution",
    shortLabel: "Proceed with caution",
    cls: "inv-verdict-caution",
    icon: "!",
  },
  rejected: {
    label: "Blocked",
    shortLabel: "Blocked",
    cls: "inv-verdict-rejected",
    icon: "✕",
  },
};

export function VerdictBadge({
  verdict,
  confidence,
  compact = false,
}: {
  verdict: Verdict;
  confidence?: number;
  compact?: boolean;
}) {
  const s = STYLES[verdict];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-xs font-semibold ${s.cls}`}
    >
      <span
        aria-hidden
        className="inv-mono inline-grid h-4 w-4 place-items-center rounded-full bg-current/15 text-[10px] font-bold leading-none"
      >
        {s.icon}
      </span>
      <span>{compact ? s.shortLabel : s.label}</span>
      {verdict === "verified" && confidence !== undefined && (
        <span className="inv-mono opacity-80">· {Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}

export function CautionBanner({ summary }: { summary: string }) {
  const message = summary.includes("proceed with caution")
    ? "Automated rules passed, but we couldn’t verify full event signals with high confidence. Double-check the organiser before sharing personal details."
    : summary;

  return (
    <div
      role="note"
      aria-label="Unverified invite notice"
      className="inv-verdict-caution flex items-start gap-3 p-3.5 text-xs sm:text-sm"
      style={{ borderRadius: "var(--inv-radius-input)" }}
    >
      <span
        aria-hidden
        className="inv-mono mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current/30 text-xs font-bold"
      >
        !
      </span>
      <div className="min-w-0 flex-1 leading-relaxed">
        <p className="font-semibold">
          Unverified invite — proceed with caution.
        </p>
        <p className="mt-0.5 opacity-90">{message}</p>
      </div>
    </div>
  );
}
