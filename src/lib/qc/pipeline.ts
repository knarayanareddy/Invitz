import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, inviteGroups, invites, qcGuidelines, type QcFinding, type Verdict } from "@/db/schema";
import { canonicalizeUrl } from "@/lib/url";
import { aiReview, type AiResult } from "./ai";
import { CAUTION_MESSAGE, decide } from "./decide";
import { fetchPage, type PageMeta } from "./fetch-page";
import { inspectText, inspectUrl, type Issue } from "./rules";

export { CAUTION_MESSAGE, decide };

/**
 * The QC pipeline. Order matters (cheap -> expensive):
 *   1. URL rules          (sync, free)
 *   2. behaviour rules    (DB: rate limit, duplicates)
 *   3. page fetch         (network, SSRF-hardened)  -- skipped if already blocked
 *   4. redirect URL/dupe  (re-verify finalUrl after redirects)
 *   5. text rules         (note + page title/description/body)
 *   6. AI review          (paid API)                -- skipped if already blocked
 *   7. decide()           (pure function, unit-testable)
 */

export type QcInput = {
  url: URL;
  canonicalUrl: string;
  note: string;
  userId: string;
  groupIds: string[];
  audiences: string[];
};

export type QcResult = {
  verdict: Verdict;
  confidence: number;
  summary: string;
  findings: QcFinding[];
  provider: string;
  model: string | null;
  page: PageMeta | null;
  ai: AiResult | null;
  durationMs: number;
  rateLimited: boolean;
};

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

const DATE_SIGNAL_RE =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|märz|mai|okt|dez|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|janvier|février|mars|avril|juin|juillet|août|septembre|octobre|novembre|décembre)[a-z.]*\s+\d{1,2}\b|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|märz|mai|okt|dez|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|janvier|février|mars|avril|juin|juillet|août|septembre|octobre|novembre|décembre)\b|\b20\d{2}-\d{2}-\d{2}\b|\b\d{1,2}[/.]\d{1,2}[/.]20\d{2}\b/i;

export async function loadGuidelines() {
  return db.select().from(qcGuidelines).orderBy(qcGuidelines.sortOrder);
}

async function hasDuplicateInGroups(canonicalUrls: string[], groupIds: string[], weekAgo: Date) {
  if (canonicalUrls.length === 0 || groupIds.length === 0) return false;
  const dupes = await db
    .select({ id: invites.id })
    .from(invites)
    .innerJoin(events, eq(events.id, invites.eventId))
    .innerJoin(inviteGroups, eq(inviteGroups.inviteId, invites.id))
    .where(
      and(
        inArray(events.canonicalUrl, canonicalUrls),
        eq(invites.status, "published"),
        gte(invites.createdAt, weekAgo),
        inArray(inviteGroups.groupId, groupIds),
      ),
    )
    .limit(1);
  return dupes.length > 0;
}

export async function runQc(input: QcInput): Promise<QcResult> {
  const t0 = Date.now();
  const guidelines = await loadGuidelines();
  const byKey = new Map(guidelines.map((g) => [g.key, g]));
  const findings: QcFinding[] = [];
  let rateLimited = false;

  const add = (issues: Issue[], source: QcFinding["source"] = "rule") => {
    for (const issue of issues) {
      const g = byKey.get(issue.code);
      if (!g || !g.enabled) continue;
      if (!findings.some((f) => f.code === issue.code && f.message === issue.message)) {
        findings.push({ code: issue.code, severity: g.severity, message: issue.message, source });
      }
      if (issue.code === "rate_limit" && g.severity === "block") {
        rateLimited = true;
      }
    }
  };
  const hasBlock = () => findings.some((f) => f.severity === "block");

  // 1. URL rules
  add(inspectUrl(input.url));

  // 2. Behaviour rules
  const behaviour: Issue[] = [];
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [{ count: recent }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invites)
    .where(and(eq(invites.sharedById, input.userId), gte(invites.createdAt, hourAgo)));
  if (recent >= num(process.env.QC_MAX_SHARES_PER_HOUR, 10)) {
    behaviour.push({ code: "rate_limit", message: "You've shared a lot of invites in the last hour. Please slow down." });
  }
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (await hasDuplicateInGroups([input.canonicalUrl], input.groupIds, weekAgo)) {
    behaviour.push({ code: "duplicate", message: "This event was already shared to one of these groups in the last 7 days." });
  }
  add(behaviour);

  // 3. Page fetch
  let page: PageMeta | null = null;
  if (!hasBlock()) {
    try {
      page = await fetchPage(input.url.toString());
    } catch (err) {
      add([
        {
          code: "unreachable_page",
          message: `Invitz couldn't open the page (${err instanceof Error ? err.message : "unknown error"}).`,
        },
      ]);
    }
  }

  // 4. Re-validate final URL after redirects against URL rules and duplicates
  if (page && !hasBlock()) {
    try {
      const finalUrlObj = new URL(page.finalUrl);
      const finalCanon = canonicalizeUrl(finalUrlObj);
      if (finalCanon !== input.canonicalUrl) {
        add(inspectUrl(finalUrlObj));
        if (!hasBlock() && (await hasDuplicateInGroups([finalCanon], input.groupIds, weekAgo))) {
          add([{ code: "duplicate", message: "The destination event was already shared to one of these groups in the last 7 days." }]);
        }
      }
    } catch {
      /* ignore unparseable finalUrl */
    }
  }

  // 5. Text rules + event-signal check (include body text excerpt)
  add(inspectText([input.note, page?.title, page?.description, page?.text?.slice(0, 3000)].filter(Boolean).join("\n")));
  if (page && !hasBlock()) {
    const looksDated = !!page.event?.startDate || DATE_SIGNAL_RE.test(`${page.title} ${page.description} ${page.text}`);
    if (!looksDated) {
      add([{ code: "weak_event_signals", message: "The page doesn't show a clear date, so it may not be a specific event." }], "page");
    }
  }

  // 6. AI review
  let ai: AiResult | null = null;
  if (!hasBlock()) {
    ai = await aiReview({
      url: page?.finalUrl ?? input.url.toString(),
      host: page?.finalUrl ? new URL(page.finalUrl).hostname : input.url.hostname,
      note: input.note,
      audiences: input.audiences,
      page,
      guidelines: guidelines.filter((g) => g.scope === "ai" && g.enabled).map((g) => ({ title: g.title, description: g.description })),
    });
  }

  // 7. Decide
  const decision = decide(findings, ai);
  if (ai) {
    const aiSeverity: QcFinding["severity"] =
      decision.verdict === "rejected" && ai.verdict === "spam"
        ? "block"
        : ai.verdict === "legit"
          ? "info"
          : "warn";
    for (const reason of ai.reasons) {
      findings.push({ code: "ai_review", severity: aiSeverity, message: reason, source: "ai" });
    }
  }
  if (decision.verdict === "caution" && !ai) {
    findings.push({
      code: "ai_unavailable",
      severity: "warn",
      message: "Automated AI review was unavailable or failed, so Invitz can't be confident about this link.",
      source: "rule",
    });
  }

  return {
    ...decision,
    findings,
    provider: ai?.provider ?? "rules",
    model: ai?.model ?? null,
    page,
    ai,
    durationMs: Date.now() - t0,
    rateLimited,
  };
}
