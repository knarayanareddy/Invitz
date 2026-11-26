import { db } from "@/db";
import { qcGuidelines } from "@/db/schema";
import { aiConfigured } from "@/lib/qc/ai";

export const dynamic = "force-dynamic";

const SEV = { block: "Blocks the share", warn: "Adds a caution label", info: "Informational" } as const;

export default async function GuidelinesPage() {
  const rows = await db.select().from(qcGuidelines).orderBy(qcGuidelines.sortOrder);
  const enabled = rows.filter((r) => r.enabled);
  const ai = aiConfigured();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">How Invitz quality control works</h1>
        <p className="mt-2 text-stone-600">
          Every share is checked <i>before</i> anyone is notified. The same published rulebook drives both our automatic rules and the AI reviewer.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm"><p className="font-semibold text-emerald-800">✓ Verified</p><p className="mt-1 text-emerald-900">Passed every rule and the AI is confident it’s a real event. Pushed to your channels.</p></div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><p className="font-semibold text-amber-900">⚠ Proceed with caution</p><p className="mt-1 text-amber-900">We couldn’t validate it with confidence. It’s shown with a warning and not pushed unless you opt in.</p></div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm"><p className="font-semibold text-rose-800">✕ Blocked</p><p className="mt-1 text-rose-900">Clear policy violation or high-confidence spam. Nobody is notified.</p></div>
      </div>

      <p className={`rounded-lg px-4 py-3 text-sm ring-1 ${ai ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-900 ring-amber-200"}`}>
        {ai
          ? "AI review is active on this server."
          : "AI review is NOT configured on this server (set OPENAI_API_KEY or ANTHROPIC_API_KEY). Until then every link that passes the rules is labelled “proceed with caution”, never “verified”."}
      </p>

      <ul className="space-y-3">
        {enabled.map((g) => (
          <li key={g.key} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{g.title}</h2>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{g.scope === "ai" ? "AI-reviewed" : "Automatic rule"} · {SEV[g.severity]}</span>
            </div>
            <p className="mt-1 text-sm text-stone-600">{g.description}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-stone-500">No system is perfect. If a good invite was blocked, or a bad one slipped through, use the Report button on the invite.</p>
    </div>
  );
}
