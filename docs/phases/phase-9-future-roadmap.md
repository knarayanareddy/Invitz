# Phase 9 — Future Roadmap & Extensibility

**Goal:** make sure the next 12–24 months of ideas can be added *without rewrites*. Each item lists the existing seam it plugs into, the work, and the risks. Prioritise by user feedback and the metrics from Phase 8.

## 1. How change is kept cheap (rules for every future PR)

1. **New external integration ⇒ new adapter**, never `if (provider === …)` scattered through code.
2. **Policy change ⇒ data change** (`qc_guidelines`, flags, thresholds) before code change.
3. **Enumerations are text unions** — add a value, no DB migration.
4. **Every feature behind a flag** until proven; flags are removed within 2 releases of full rollout.
5. **Additive API/DB changes only** (expand → migrate → contract).
6. **Pure core, impure edges:** `decide()`, rules, ranking, permissions stay pure and unit-tested.
7. **ADR for every cross-cutting decision** (`docs/adr/NNNN-*.md`).
8. **Evaluation gates** protect the QC engine from regressions whenever model/prompt/rules change.

## 2. Roadmap candidates

### 2.1 More channels
| Channel | Seam | Notes |
|---|---|---|
| Telegram | `ChannelAdapter` (+ `telegram` in `ChannelType`) | Bot API is free and reliable; deep-link `/start <token>` verification instead of codes |
| Slack | adapter + OAuth install | Workspace-level subscriptions to communities |
| Microsoft Teams | adapter | Via incoming webhooks / Workflows |
| Web push / PWA | adapter using `web-push` | Good free alternative to WhatsApp |
| SMS | adapter (Twilio) | Costly; reserve for high-priority reminders |
| RSS / iCal feeds per community/person | read-only route | Cheap, lets power users pipe to anything |
| Webhooks-out | `webhooks_out` table | Let communities integrate with Zapier/n8n |

### 2.2 Beyond events
Generalise `events` to **items** with `kind` (`event | job | grant | cfp | course | hackathon | resource`). QC prompt gets a per-kind addendum; cards render per kind. Because verdict, visibility, fan-out and channels are kind-agnostic, this is mostly UI + prompt work.

### 2.3 Smarter QC
* **Verified organiser** badges via domain verification (DNS TXT / meta-tag) or OAuth with Luma/Eventbrite/Meetup.
* **Cross-source corroboration:** same event on multiple trusted platforms → higher confidence.
* **Image analysis** (vision model) for fake flyers/QR-code scams; QR decoding.
* **Headless rendering** for JS-only pages (Playwright worker in a sandbox, behind the egress proxy).
* **Fine-tuned/distilled classifier** trained on your labelled data to cut cost and latency; LLM only for the grey zone.
* **Per-community strictness:** community owners can raise/lower thresholds within platform limits.
* **Explainability UI:** highlight page sections that triggered findings.

### 2.4 Personalisation & discovery
* Free-form tags + embeddings (`pgvector`) for semantic interest matching ("causal inference" ≈ "econometrics").
* "Events near me", travel mode, weekly personalised digests.
* Collections / lists ("My ICLR 2026 side events"), shareable.
* Following **communities across channels** (Discord bot subscribes a whole channel to `#ml-engineers`).

### 2.5 Social & engagement
* Interested/Going signals, "friends going", comments or threads (needs a moderation upgrade first), reactions.
* Curator profiles with stats and a "Trusted curator" programme.
* Organiser dashboards: views/clicks per invite (privacy-safe aggregates).

### 2.6 Platform
* **Public API `/api/v1`** (OpenAPI spec, API keys, rate limits) and a **browser extension** ("Share to Invitz" on any page, auto-fills the note).
* **Mobile apps** (React Native/Expo) reusing the API; push via APNs/FCM.
* **Org/Workspaces:** companies, universities, accelerators with SSO and private communities.
* **Internationalisation:** UI translations, per-language communities, AI language detection.
* **Data export / partner feeds.**

### 2.7 Monetisation (see P8.7)
Plans & entitlements module, Stripe billing, usage metering for WhatsApp digests, sponsored (clearly labelled) placements.

## 3. Technical debt & platform evolution watch-list

| Area | Trigger to act | Action |
|---|---|---|
| pg-boss throughput | queue lag p95 > 1 min at peak | move delivery to SQS/BullMQ; keep job contracts |
| Single DB | CPU > 70 % sustained | read replicas → partitioning → (rare) service extraction of `notify` |
| Monolith friction | > 8 engineers stepping on each other | extract `worker` and `qc` into separate deployables first (module boundaries already enforce it) |
| LLM vendor risk | price/policy change | switch via adapter; keep eval set to validate the replacement in a day |
| Next.js/React upgrades | each major | upgrade quarterly; keep e2e suite as safety net |

## 4. Template: how to add a feature (checklist)

1. Write a one-page spec: problem, users, success metric, risks, privacy impact.
2. Identify the seam (adapter / guideline / flag / new module). If none fits, write an ADR.
3. Schema change? → additive migration + backfill plan + rollback.
4. Implement behind a flag; add unit + integration tests; extend the authorisation matrix if visibility is affected.
5. If it changes what content is shown or sent: **re-run QC evaluation** and review the notification volume impact.
6. Update docs (`docs/`), `.env.example`, runbooks, and the guidelines page if policy changed.
7. Roll out: staff → 5 % → 50 % → 100 % with dashboard watch; remove the flag.
