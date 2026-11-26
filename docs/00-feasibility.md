# 00 — Feasibility, Risks & Cost

## 1. Verdict

| Capability in your brief | Feasible? | Notes |
|---|---|---|
| Share any event link, any platform/organiser | ✅ Easy | Platform-agnostic by design: we only need a public URL. Metadata comes from OpenGraph / JSON-LD `Event` / page text, never from platform APIs. |
| Wide, topic-specific, and custom groups | ✅ Easy | Standard groups + membership model. |
| AI-model QC on every share with confidence + "proceed with caution" | ✅ Feasible | LLM + deterministic rules. Needs *calibration* and an evaluation set (Phase 3). Cost per check is a fraction of a cent with small models. |
| Profiles + interests | ✅ Easy | |
| "Notify me when user X posts" | ✅ Easy | Follow edge with a `notify` flag. |
| Notifications via **Discord** | ✅ Easy | Webhooks (per user) or a bot. |
| Notifications via **WhatsApp** | ⚠️ Feasible with constraints | Official **WhatsApp Business Cloud API** only. Business-initiated messages require **pre-approved templates** and explicit **opt-in**; pricing is per message. You cannot send arbitrary text to people outside the 24-hour window. Unofficial libraries risk number bans: do not use them. |
| Notifications via **Signal** | ⚠️ Feasible, unofficial | Signal has **no official bot/business API**. The practical route is a self-hosted `signal-cli` / `signal-cli-rest-api` on a dedicated number. It works but is outside Signal's intended use, is operationally fragile, and can be rate-limited or banned. Ship as a **beta, best-effort** channel and keep it behind an adapter so it can be dropped without touching the rest. |
| Future features / changes | ✅ | Adapter pattern for channels and AI providers; DB-driven rulebook; text-column enums; versioned API. See [01-architecture](./01-architecture.md). |

**Bottom line:** build it. The product risk is *trust* (a wrong "Verified" badge or a wrongly blocked invite damages credibility fast), and the platform risk is WhatsApp/Signal. Neither blocks the MVP.

## 2. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Phase |
|---|------|-----------|--------|------------|-------|
| R1 | AI marks spam as Verified (false negative) | Med | High | Verified requires **all rules clean AND AI confidence ≥ threshold**; thresholds env-tunable; user reports auto-hide at 3; sample 5 % of Verified for human review; evaluation set gates every prompt/model change | 3, 6, 7 |
| R2 | AI blocks a legit invite (false positive) | Med | Med | Auto-block only at high confidence (≥ 0.85) — otherwise label *Caution*; appeals flow; show the reasons transparently | 3, 6 |
| R3 | Prompt injection via page content / note | High | Med | Page text is passed as untrusted data; system prompt forbids following it; injection attempts are treated as spam signals; model output is schema-validated and never executes anything; the model can't choose to *skip* rules | 3 |
| R4 | SSRF through the link fetcher | High | Critical | Resolve DNS and block private/link-local/loopback/metadata ranges; ports 80/443 only; manual redirect re-validation; size and time limits; egress proxy in prod | 3, 6 |
| R5 | WhatsApp template rejection / policy ban | Med | High | Utility-category template, explicit opt-in via OTP, easy opt-out, per-user frequency caps, digest mode | 4 |
| R6 | Signal number banned / API breaks | Med | Low–Med | Beta label, dedicated number, strict rate caps, adapter isolation | 4 |
| R7 | The product itself becomes a spam vector (people share promos) | High | High | QC on every share, rate limits, trust score, new-account throttles, duplicate detection, group-level moderation | 3, 6 |
| R8 | LLM cost / latency spikes | Med | Med | Small model by default, cache by canonical URL + content hash, skip AI if rules already blocked, async queue, circuit breaker → "Caution" fallback | 3, 8 |
| R9 | Privacy / consent (phone numbers, messaging) | Med | High | OTP-verified opt-in, encryption at rest, data minimisation toward the AI vendor (no e-mail, phone, or names), DPA with vendors, delete/export tools | 6, 7 |
| R10 | Cold-start (empty communities) | High | High | Seed curated communities, invite-your-circle flows, import follows, weekly digest, partner with 3–5 community organisers before launch | 8 |
| R11 | Scraping ToS/robots concerns | Low | Med | Identify as `InvitzBot`, respect `robots.txt` (Phase 3 task), fetch only the one URL a user shared, cache | 3 |
| R12 | Time-zone / event data wrong | Med | Low | Prefer JSON-LD, store UTC, show source link prominently, label "details extracted automatically" | 2 |

## 3. Cost model (order of magnitude, verify current vendor pricing)

| Item | Assumption | Approx. monthly |
|------|-----------|-----------------|
| Hosting (web + worker) | 1 small web + 1 worker (Fly/Railway/Render/Vercel+worker) | $20–60 |
| Postgres (managed) | Neon/Supabase/RDS small | $15–50 |
| Redis (rate limits/queues, optional) | Upstash/managed | $0–20 |
| AI QC | ~2k input + ~200 output tokens per check on a small model → well under **$0.001** per check. 10k shares/day ≈ $5–10/day | $150–300 at 10k/day; ≈ $5 at 100/day |
| WhatsApp | Per-message by template category; one message per recipient per invite | usage-based: **the dominant cost at scale** → default to digests and let users cap daily messages |
| Signal | Number + small VM | $5–10 |
| Discord | Free | $0 |
| Observability (Sentry, logs) | Free/low tier | $0–30 |

**Cost levers:** cache QC by canonical URL; digest mode for WhatsApp; free channels first (in-app, Discord, e-mail); QC only once per event for repeated shares (re-run only rules + note).

## 4. Build vs buy

| Concern | Recommendation |
|---|---|
| Auth | **Buy/adopt:** Auth.js (self-hosted) or Clerk. Don't hand-roll. |
| Queue | **pg-boss** (Postgres-backed) first — no new infra; move to BullMQ/SQS only if needed. |
| Moderation of text | Add the provider's moderation endpoint as a cheap pre-filter later; keep your own rulebook as source of truth. |
| WhatsApp | **Meta Cloud API directly** (or Twilio if you need unified billing/support). |
| Search | Postgres full-text + `pg_trgm` first; Meilisearch/Typesense when needed. |
| Email | Resend/Postmark. |

## 5. Success metrics (define before building)

* **Trust:** % of Verified invites later reported (target < 1 %); % of Blocked invites successfully appealed (target < 10 %).
* **Quality:** precision/recall of QC on the labelled evaluation set (Phase 3 targets: spam recall ≥ 95 %, Verified precision ≥ 98 %).
* **Engagement:** share → open rate; notification → click rate; D7/D30 retention.
* **Delivery:** external channel delivery success ≥ 98 %; p95 share-to-notify latency < 60 s.
* **Cost:** QC cost per share; notification cost per click.

## 6. Out of scope for v1 (explicitly)

Ticketing/payments, hosting events, RSVP/attendee management, native mobile apps (PWA instead), paid promotion. All are listed in [Phase 9](./phases/phase-9-future-roadmap.md) so they can be added without redesign.
