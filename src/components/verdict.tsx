import type { Verdict } from "@/db/schema";

const STYLES: Record<Verdict, { label: string; cls: string; icon: string }> = {
  verified: { label: "Verified", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: "✓" },
  caution: { label: "Unverified · proceed with caution", cls: "bg-amber-50 text-amber-800 ring-amber-200", icon: "⚠" },
  rejected: { label: "Blocked", cls: "bg-rose-50 text-rose-700 ring-rose-200", icon: "✕" },
};

export function VerdictBadge({ verdict, confidence }: { verdict: Verdict; confidence?: number }) {
  const s = STYLES[verdict];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
      {verdict === "verified" && confidence !== undefined && (
        <span className="opacity-70">· {Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}

export function CautionBanner({ summary }: { summary: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span aria-hidden className="text-lg leading-none">⚠️</span>
      <p>
        <strong className="font-semibold">Might be spam, or we can’t verify it.</strong>{" "}
        {summary.includes("proceed with caution") ? "Please proceed with caution before clicking or sharing personal details." : summary}
      </p>
    </div>
  );
}
