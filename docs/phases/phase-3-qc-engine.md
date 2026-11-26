# Phase 3 — The QC Engine (the heart of Invitz)

**Goal:** every share is checked against a published rulebook by deterministic rules *and* an AI model; the result is one of **Verified**, **Caution ("might be spam — proceed with caution")**, or **Blocked**, with transparent reasons and measured accuracy.
**Duration:** ~3 weeks · **Prereqs:** Phase 2 · **Depends on:** an LLM API key, a labelled evaluation set.

## Prototype status
| Item | State | File |
|---|---|---|
| URL rules (HTTPS, raw IP, blocklist, shortener, suspicious TLD) | ✅ | `qc/rules.ts` |
| Text rules (scam / promo language) | ✅ | `qc/rules.ts` |
| Behaviour rules (rate limit, duplicate in group) | ✅ | `qc/pipeline.ts` |
| SSRF-safe fetch + OG/JSON-LD extraction | ✅ | `qc/fetch-page.ts` |
| AI review (OpenAI / Anthropic / OpenAI-compatible) | ✅ | `qc/ai.ts` |
| Decision function (`decide`) | ✅ pure | `qc/pipeline.ts` |
| Rulebook in DB + public page | ✅ | `qc_guidelines`, `/guidelines` |
| Audit row per check | ✅ | `qc_checks` |
| Async execution, caching, robots.txt, eval harness, domain reputation, cost caps | ❌ → this phase |

---

## Step-by-step

### 3.1 Write the rulebook first (policy before code)
1. Workshop 1 hour: list what you consider *spam* vs *acceptable promotion*. Example edge cases: paid workshops (OK), "free" webinar that funnels to a sales call (Caution), crypto "giveaways" (Block), recruiting events (OK), MLM "business opportunity" (Block), religious/political events (OK if specific, labelled), adult content (Block).
2. For each rule decide `scope` (rule/ai), `severity` (block/warn/info) and the sharer-facing message. Insert/update in `qc_guidelines` (these rows already exist for the 16 starter rules; extend them).
3. Publish the rules at `/guidelines` (exists) so users know the standard. Version it: add `qc_guideline_versions` (snapshot at each change) and store `ruleset_version` on `qc_checks`.

### 3.2 Build the labelled evaluation set (do this *before* tuning)
1. Collect **300+ real links**: ~100 clearly legit events (Luma, Eventbrite, Meetup, conference sites, university seminars), ~100 clearly spam/scam, ~100 ambiguous (thin pages, shorteners, JS-only pages, expired events).
2. Label each with the expected verdict (`verified | caution | rejected`) and a reason. Two labellers; resolve disagreements.
3. Store in `eval/dataset.jsonl`; snapshot page HTML into `eval/fixtures/` so tests are deterministic and offline.
4. Targets: **spam recall ≥ 95 %**, **Verified precision ≥ 98 %**, **false-block rate on legit ≤ 2 %**, ambiguous → Caution ≥ 80 %.

### 3.3 Harden the deterministic layer
1. `robots.txt`: fetch/cache per host (24 h); if the path is disallowed for `InvitzBot`, skip scraping and mark `unreachable_page` (don't circumvent).
2. Add **Google Safe Browsing** (or Web Risk) lookup → `blocklisted_domain` when flagged; cache 6 h.
3. **Domain reputation** (`domain_reputation` table): count of verified / cautioned / blocked / reported shares per host; hosts with high confirmed-spam ratio become `suspicious_domain`; hosts with long clean history gain trust (never auto-Verified without AI).
4. Redirect-chain length and cross-domain redirect check (final host ≠ submitted host and not a known platform → warn).
5. Content checks: page title/description language vs note; very short page; login-wall pages (`401/403`) → Caution with a precise message.
6. Add **homoglyph/punycode** normalisation and compare against a list of popular event platforms for brand-impersonation warnings.
7. Keep every rule a pure function returning `{ code, message }`; severity/enabled **only** from `qc_guidelines`.

### 3.4 AI layer: make it reliable
1. **Prompt:** already generated from enabled `scope = 'ai'` guidelines. Keep: untrusted-data framing, JSON-only schema, calibration instruction ("answer `unknown` with low confidence if thin").
2. **Structured outputs:** switch to provider-native JSON schema / tool-calling when available; validate with zod; on invalid output retry once, then fall back to Caution.
3. **Confidence calibration:** raw LLM confidences are not probabilities. Run the evaluation set, plot confidence vs. accuracy per bucket, and **set `QC_VERIFY_THRESHOLD` / `QC_REJECT_THRESHOLD` from the data** (e.g. pick the threshold where Verified precision ≥ 98 %). Re-calibrate on every model change.
4. **Defence in depth against prompt injection:** (a) truncate/clean page text (strip hidden elements, zero-width chars), (b) the model can only return a verdict — it has no tools, (c) injection phrases ("ignore previous instructions", "you are now…") trigger a deterministic `promo_language`/`scam_language` style rule, (d) the verdict is never trusted above the deterministic blocks.
5. **Two-tier models (cost):** cheap small model for all checks; escalate to a stronger model only when the first answer is `suspicious/unknown` with confidence in a grey zone (0.4–0.75).
6. **Provider moderation endpoint** as an extra pre-filter on note + page text (free on most providers).
7. **Caching:** `qc_cache(canonical_url, content_hash, ruleset_version, model) → ai_result`, TTL 24 h. Re-sharing the same event skips the paid call; behaviour rules still run for the new sharer.
8. **Timeouts and circuit breaker:** 20 s timeout (exists); after N consecutive failures open the breaker for 60 s and degrade to rules-only (= Caution, never Verified). Surface the degraded state in `/api/ready` and Sentry.
9. **Cost guardrail:** daily spend counter; at 80 % alert, at 100 % degrade to rules-only.
10. **Privacy:** send only URL, note, page excerpt, audience names (exists). Add a scrubber that redacts e-mails/phones from page text before sending.

### 3.5 Make QC asynchronous
1. Install `pg-boss`; create a worker entry (`worker/index.ts`) deployed as a separate process.
2. New share flow: server action validates → inserts `invites` with `status='pending_qc'` → enqueues `qc.run` → returns immediately. Invite page shows "Checking…" and refreshes by SSE/polling.
3. Worker job `qc.run(inviteId)`: runs the pipeline, writes `qc_checks`, updates invite, enqueues `notify.fanout`. Idempotency key = inviteId; retries with exponential backoff (3 attempts); permanent failure → verdict Caution + `ai_unavailable`.
4. Add `pending_qc` to `InviteStatus` (text column, no migration) and filter it from feeds (already filtered by `status='published'`).
5. Per-host concurrency limit (e.g. 2) and global concurrency (e.g. 10) so you never hammer an organiser's site.

### 3.6 Transparency & user experience
1. **Verdict copy** (single source in `components/verdict.tsx`):
   * Verified: "✓ Verified — looks like a genuine event."
   * Caution: "Might be spam, or we can't verify it — please proceed with caution."
   * Blocked (to sharer only): specific reason + how to fix.
2. Show **why** (findings list with severity chips — exists) and **what we checked** (page fetched? AI model?).
3. **Appeal button** on blocked invites (P6 handles the moderator side).
4. **Never** show raw model output or prompts to users.

### 3.7 Evaluation harness & regression gates
1. `npm run qc:eval` → runs the dataset through `runQc` (page fetching mocked from fixtures, AI real or recorded) and prints a confusion matrix + precision/recall.
2. CI job runs with **recorded AI responses** (cassettes) on every PR; a nightly job runs against the live model.
3. Any change to prompt, model, thresholds, or rules must keep targets from 3.2, or the PR fails.
4. **Shadow mode** for new models/prompts: run both, store the challenger's verdict in `qc_checks.ai_raw.shadow`, compare offline before switching.
5. **Human review loop:** random 5 % of Verified + all Caution with confidence > 0.6 go to the moderation queue (P6). Their labels are appended to the dataset monthly.

### 3.8 Tests
* Unit (pure): every rule with positive/negative cases; `decide()` truth table (all rows of the table in 01-architecture); `isPrivateAddress` (IPv4/IPv6/mapped); URL canonicalisation.
* Security: SSRF suite — `http://127.0.0.1`, `http://[::1]`, `http://169.254.169.254`, DNS rebinding hostnames, `file://`, redirect-to-private, `:8080` port, 10 MB response, slowloris (time limit).
* Integration: pipeline with fixtures → expected verdicts; AI timeout → Caution; AI invalid JSON → Caution.
* Property tests: verdict never `verified` when any `block`/`warn` finding exists or when AI is null.

---

## Acceptance criteria
- [ ] Evaluation targets met (spam recall ≥ 95 %, Verified precision ≥ 98 %)
- [ ] With the AI disabled, **no invite can be Verified** (test)
- [ ] SSRF test suite passes; fetch never reaches a private address
- [ ] p95 share → verdict < 15 s (sync) or < 2 s ack (async) with visible progress
- [ ] Every verdict has an immutable `qc_checks` row including ruleset version and model
- [ ] Policy change (disable a rule, change severity) takes effect without a deploy
- [ ] Daily AI cost cap works and degrades safely

## Risks
| Risk | Mitigation |
|---|---|
| LLM drifts after provider updates | Pin model version; nightly eval; shadow mode for upgrades |
| Over-blocking annoys good users | Auto-block only at ≥ 0.85; Caution for the grey zone; appeal path |
| Scraper blocked by sites | Respect robots; Caution is the honest outcome; optionally ask sharer for event title/date |
