import { describe, expect, it } from "vitest";
import { parseAiOutput } from "@/lib/qc/ai";
import { CAUTION_MESSAGE, decide } from "@/lib/qc/decide";
import type { QcFinding } from "@/db/schema";

const warnFinding: QcFinding = { code: "url_shortener", severity: "warn", message: "Shortened", source: "rule" };
const blockFinding: QcFinding = { code: "scam_language", severity: "block", message: "Scam", source: "rule" };

describe("decide()", () => {
  it("blocks whenever any block-severity finding exists regardless of AI", () => {
    const res = decide([blockFinding], { verdict: "legit", confidence: 0.99, reasons: ["looks good"] });
    expect(res.verdict).toBe("rejected");
    expect(res.confidence).toBe(0.95);
    expect(res.summary).toContain("Blocked: Scam");
  });

  it("returns caution when AI is unavailable even with zero findings", () => {
    const res = decide([], null);
    expect(res.verdict).toBe("caution");
    expect(res.confidence).toBe(0.4);
    expect(res.summary).toContain(CAUTION_MESSAGE);
  });

  it("blocks when AI says spam at or above reject threshold", () => {
    const res = decide([], { verdict: "spam", confidence: 0.85, reasons: ["Crypto giveaway"] });
    expect(res.verdict).toBe("rejected");
    expect(res.summary).toBe("Blocked: Crypto giveaway");
  });

  it("returns caution when AI says spam below reject threshold", () => {
    const res = decide([], { verdict: "spam", confidence: 0.7, reasons: ["Maybe spam"] });
    expect(res.verdict).toBe("caution");
    expect(res.confidence).toBe(0.7);
  });

  it("verifies only when AI says legit >= verify threshold AND there are zero warn findings", () => {
    const ok = decide([], { verdict: "legit", confidence: 0.82, reasons: ["Real meetup"] });
    expect(ok.verdict).toBe("verified");
    expect(ok.confidence).toBe(0.82);

    const warned = decide([warnFinding], { verdict: "legit", confidence: 0.95, reasons: ["Real meetup"] });
    expect(warned.verdict).toBe("caution");
    expect(warned.confidence).toBe(0.7);
  });
});

describe("parseAiOutput()", () => {
  it("parses valid JSON inside surrounding prose", () => {
    const res = parseAiOutput(
      'Result: {"verdict":"legit","confidence":0.91,"reasons":["Concrete date and venue"],"extracted":{"title":"ML Conf"}}',
      { name: "openai", model: "gpt-4o-mini" },
    );
    expect(res.verdict).toBe("legit");
    expect(res.confidence).toBe(0.91);
    expect(res.extracted.title).toBe("ML Conf");
  });

  it("rejects out-of-range confidences like 50 instead of clamping to 1.0", () => {
    expect(() =>
      parseAiOutput('{"verdict":"legit","confidence":50,"reasons":[]}', { name: "openai", model: "gpt-4o-mini" }),
    ).toThrow();
  });
});
