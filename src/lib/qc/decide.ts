import type { QcFinding, Verdict } from "@/db/schema";

export type AiVerdict = "legit" | "suspicious" | "spam" | "unknown";

export type AiDecisionInput = {
  verdict: AiVerdict;
  confidence: number;
  reasons: string[];
};

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const CAUTION_MESSAGE =
  "We couldn't verify this invite with confidence. It might be spam or inaccurate — please proceed with caution.";

export function decide(
  findings: QcFinding[],
  ai: AiDecisionInput | null,
  thresholds?: { verifyAt?: number; rejectAt?: number },
) {
  const verifyAt = thresholds?.verifyAt ?? num(process.env.QC_VERIFY_THRESHOLD, 0.75);
  const rejectAt = thresholds?.rejectAt ?? num(process.env.QC_REJECT_THRESHOLD, 0.85);

  const blocks = findings.filter((f) => f.severity === "block");
  if (blocks.length > 0) {
    return { verdict: "rejected" as Verdict, confidence: 0.95, summary: `Blocked: ${blocks[0].message}` };
  }
  if (!ai) {
    return {
      verdict: "caution" as Verdict,
      confidence: 0.4,
      summary: `${CAUTION_MESSAGE} (Automated AI review was unavailable.)`,
    };
  }
  if (ai.verdict === "spam" && ai.confidence >= rejectAt) {
    return {
      verdict: "rejected" as Verdict,
      confidence: ai.confidence,
      summary: `Blocked: ${ai.reasons[0] ?? "the AI reviewer judged this to be spam."}`,
    };
  }
  const warns = findings.filter((f) => f.severity === "warn");
  if (ai.verdict === "legit" && ai.confidence >= verifyAt && warns.length === 0) {
    return {
      verdict: "verified" as Verdict,
      confidence: ai.confidence,
      summary: ai.reasons[0] ?? "Looks like a genuine event invitation.",
    };
  }
  return { verdict: "caution" as Verdict, confidence: Math.min(ai.confidence, 0.7), summary: CAUTION_MESSAGE };
}
