# Phase 7 — Quality, Privacy & Compliance

**Goal:** prove the product works, is accessible, fast, and lawful before public users arrive.
**Duration:** ~2 weeks · **Prereqs:** Phases 1–6 feature-complete (code freeze for features).

## Prototype status
No automated tests, no legal pages, no a11y audit yet. Semantic HTML, `role="alert"` on errors and label/input pairing are in place as a starting point.

---

## Step-by-step

### 7.1 Test strategy (pyramid)
| Layer | Tool | What | Target |
|---|---|---|---|
| Unit | Vitest | rules, `decide`, canonicalisation, ranking, permissions, formatters | ≥ 90 % of `lib/qc`, `lib/notify`, `lib/permissions` |
| Integration | Vitest + Postgres service | server actions + DB (visibility matrix, fan-out, trust score changes, channel verification) | all actions have ≥ 1 happy + 2 failure tests |
| Contract | Vitest + mock servers | Discord/WhatsApp/Signal/LLM adapters | every status code branch |
| e2e | Playwright | sign-in, onboarding, share (verified/caution/blocked), group flow, follow + bell, settings channel verify, report, appeal | run on every PR (smoke) + nightly (full) across Chromium/WebKit/mobile viewport |
| QC evaluation | `npm run qc:eval` | accuracy on labelled dataset | targets from Phase 3 |
| Load | k6 | feed read, share write, fan-out 5 k recipients | feed p95 < 500 ms @ 200 rps; fan-out 5 k < 2 min |
| Security | ZAP baseline + manual | OWASP Top 10, SSRF suite, authz (IDOR) tests | zero high |
| Chaos | manual | LLM down, Postgres failover, Discord 429 storm, worker crash mid fan-out | degrades safely, no duplicates |

1. Create fixtures: users in each trust band, groups of each type, invites of each verdict.
2. Build the **authorisation matrix test**: for each (viewer type × invite state × group visibility) assert read/write outcome. Generate it from a table to keep it readable.
3. Set coverage gates in CI but optimise for *risk* coverage, not the number.
4. Add visual regression for verdict badges/banners (they carry meaning).

### 7.2 Accessibility (WCAG 2.2 AA)
1. Keyboard: every action reachable and operable; visible `:focus-visible` rings; logical tab order; skip-to-content link.
2. Semantics: landmarks (`header`, `nav`, `main`, `footer`), headings in order, buttons vs links used correctly, lists for feeds.
3. Colour is never the only signal: verdict badges have icon + text (already done: ✓ / ⚠ / ✕ with labels); contrast ≥ 4.5:1 verified for amber/green/red tints.
4. Forms: programmatic labels, `aria-describedby` for hints, errors with `role="alert"`, preserve input on failure (share form already does).
5. Motion: respect `prefers-reduced-motion`; no auto-playing content.
6. Targets ≥ 24×24 px; zoom to 200 % without loss; responsive down to 320 px.
7. Automate: `@axe-core/playwright` in e2e; manual screen-reader pass (VoiceOver + NVDA) on the 5 core flows.

### 7.3 Performance
1. Budgets: LCP < 2.5 s (4G mid-tier phone), CLS < 0.1, INP < 200 ms, JS on feed < 150 kB gzip.
2. Server: add `EXPLAIN ANALYZE` checks for feed, group, profile queries; N+1 audit (the group-chips query is already batched).
3. Use `next/image` via the image proxy, lazy-load below the fold, `Cache-Control` on proxied images.
4. Stream slow sections with Suspense (e.g. sidebar membership counts).
5. DB: connection pooling (PgBouncer/Neon pooler), pool size tuned to the number of instances, statement timeout 5 s, slow-query log.
6. Run Lighthouse CI on PRs; fail on budget regression.

### 7.4 Privacy & data protection (GDPR/UK-GDPR; adapt for CCPA)
1. **Data inventory & map:** what is collected (e-mail, handle, profile, interests, follows, phone/webhook, shared links, QC logs), why (lawful basis: contract for core; consent for messaging channels; legitimate interest for QC/abuse prevention), where it flows (hosting, AI vendor, Meta, e-mail vendor), retention.
2. **Vendors:** sign DPAs with the AI provider (opt out of training on API data; most API providers do this by default — confirm in writing), Meta, hosting, e-mail, Sentry; list them in the privacy policy. Select EU regions where possible; document international transfers (SCCs).
3. **Data minimisation to AI:** (exists) only URL, note, page excerpt, audience names; add the redaction step (3.4.10).
4. **User rights:** Export (JSON/ZIP), Delete (30-day grace), Rectify (profile edit), Object/Restrict (turn off processing of interests for ranking), Access log of notifications. Respond in < 30 days; build self-service so you rarely need to.
5. **Consent & preferences:** channel opt-in logged with timestamp, text version, IP; marketing e-mail separate from transactional; cookie banner only if non-essential cookies/analytics need consent (prefer cookieless analytics: Plausible/PostHog cookieless).
6. **Retention jobs:** nightly purge per the retention table (ai_raw 90 d, notifications 180 d, soft-deleted accounts 30 d, audit logs 1 y).
7. **Breach readiness:** incident response plan, 72-hour notification procedure, contacts, log-retention for forensics.
8. **DPIA** (lightweight): the system profiles interests and scores trust → document risks and mitigations (human review, appeals, transparency).
9. **Children:** 16+ in ToS; no knowingly collecting data from minors; age confirmation at sign-up.

### 7.5 Legal & policy documents (get a lawyer to review)
* **Terms of Service**: acceptable use (spam definition, prohibited content), enforcement and appeals, liability disclaimer *("QC verdicts are automated assessments, not guarantees")*, user content licence.
* **Privacy Policy**, **Cookie Policy**, **Community Guidelines** (plain-language version of the rulebook), **Messaging Terms** (WhatsApp/Signal consent, STOP, costs).
* **DSA** (if serving EU): contact point, notice-and-action process, statements of reasons, transparency report (annual).
* **Trademark/legal name check** for "Invitz" in target markets (classes 9, 38, 42) before heavy branding spend.

### 7.6 Content & UX quality
1. Copy review for every state: verified / caution / blocked / AI-unavailable / empty / error — calm, specific, actionable.
2. Localisation scaffolding: wrap strings in `next-intl`; format dates/numbers by locale; no concatenated sentences.
3. Email templates tested in major clients (Litmus/Email on Acid or manual).
4. Usability test with 5–8 target users (ML engineers, founders, a VC): task = "share this event to the right group", "find events this week", "set up Discord notifications". Fix the top 5 issues.

### 7.7 Release readiness review
Checklist reviewed in a go/no-go meeting: tests green, QC targets met, security headers, pen-test criticals closed, legal docs live, backups verified (restore drill), on-call rota, status page, rollback tested.

---

## Acceptance criteria
- [ ] CI: unit + integration + e2e smoke green; nightly full e2e + QC eval green
- [ ] Axe finds 0 serious/critical issues on core flows; manual SR pass done
- [ ] Lighthouse budgets met on feed, invite, group pages
- [ ] Export & delete tested against a real account; retention jobs verified in staging
- [ ] Legal documents published and linked in the footer and sign-up
- [ ] Usability top issues fixed

## Risks
| Risk | Mitigation |
|---|---|
| Test suite becomes slow/flaky | Parallelise; quarantine flaky tests with an owner and deadline; contract-test externals with mocks |
| Legal review late | Draft documents start in P4; book the lawyer in P5 |
