# Invitz — Product, Architecture & Build Plan

> **One-line pitch:** Share any event link with the right community (generalist, topic-specific, or your own private group). Every share is quality-checked by rules + an AI model before anyone is pinged, and unverifiable invites are clearly labelled *"might be spam — proceed with caution"*.

## Is this realisable?

**Yes.** Every part of the idea uses mature technology. The two genuinely hard parts are *not* technical features but platform constraints (WhatsApp/Signal messaging rules) and *trust calibration* (keeping the AI check precise enough that users believe the "Verified" badge). Both are addressed in [00-feasibility.md](./00-feasibility.md). A working prototype is included in this repository.

## How to read this folder

| # | Document | What it answers |
|---|----------|-----------------|
| 00 | [Feasibility & risks](./00-feasibility.md) | Can it be built? What can go wrong? What does it cost? |
| 01 | [Architecture](./01-architecture.md) | Components, flows, tech choices, extension points |
| 02 | [Data model](./02-data-model.md) | Every table, index, and planned future table |
| 03 | [Gaps & best practices checklist](./03-gaps-and-best-practices.md) | Everything *not* in your brief that a real product needs |
| P0 | [Phase 0 — Foundations](./phases/phase-0-foundations.md) | Repo, CI/CD, environments, observability baseline |
| P1 | [Phase 1 — Identity & profiles](./phases/phase-1-identity-and-profiles.md) | Auth, profiles, interests, onboarding |
| P2 | [Phase 2 — Groups & sharing](./phases/phase-2-groups-and-sharing.md) | Communities, custom groups, the share flow |
| P3 | [Phase 3 — QC engine](./phases/phase-3-qc-engine.md) | Rules, AI check, verdicts, evaluation |
| P4 | [Phase 4 — Notifications](./phases/phase-4-notifications.md) | In-app, Discord, WhatsApp, Signal, queues |
| P5 | [Phase 5 — Follows, feed & discovery](./phases/phase-5-follows-feed-discovery.md) | Follow a person, ranking, search |
| P6 | [Phase 6 — Trust, safety & security](./phases/phase-6-trust-safety-security.md) | Moderation, abuse, SSRF, appeals |
| P7 | [Phase 7 — Quality, privacy & compliance](./phases/phase-7-quality-privacy-compliance.md) | Tests, a11y, performance, GDPR |
| P8 | [Phase 8 — Launch & scale](./phases/phase-8-launch-and-scale.md) | Alpha → beta → public, scaling, ops |
| P9 | [Phase 9 — Future roadmap & extensibility](./phases/phase-9-future-roadmap.md) | How to add features without rewrites |

**Suggested timeline** (1–2 full-stack engineers + part-time designer): P0 1 wk · P1 1.5 wk · P2 2 wk · P3 3 wk · P4 3 wk → **private alpha at ~week 10** · P5 2 wk · P6 2–3 wk · P7 2 wk · P8 2 wk → **public launch at ~week 19–20**.

---

## The prototype in this repository

A working Next.js 16 (App Router) + PostgreSQL (Drizzle ORM) app that implements the core loop end-to-end.

### Run it

```bash
npm install
cp .env.example .env            # then edit values
npx drizzle-kit push            # creates tables
npm run dev                     # http://localhost:3000
```

On first request the app seeds the topic communities, the QC rulebook, and (unless `INVITZ_DEMO_SEED=false`) four demo users and four demo invites. Use **Sign in → demo user** to explore.

### What works today

| Capability | Status | Where |
|------------|--------|-------|
| Passwordless e-mail sign-in (signed cookie) | ✅ prototype-grade | `src/lib/auth.ts`, `src/app/actions/auth.ts` |
| Profiles, headline/bio, interests → auto-join communities | ✅ | `src/app/settings`, `src/app/actions/settings.ts` |
| Wide group ("Everyone"), 10 topic communities, custom private/public groups | ✅ | `src/app/groups`, `src/app/actions/groups.ts` |
| Share *any* https link to multiple audiences | ✅ | `src/app/share`, `src/app/actions/invites.ts` |
| **QC pipeline**: URL rules → behaviour rules → safe page fetch → text rules → AI review → decision | ✅ | `src/lib/qc/*` |
| Three verdicts: Verified / Caution ("might be spam, proceed with caution") / Blocked | ✅ | `src/lib/qc/pipeline.ts` (`decide`) |
| Rulebook stored in DB and fed to both rules and AI prompt | ✅ | `qc_guidelines` table, `/guidelines` page |
| Follow a person + notification "bell" | ✅ | `src/app/people`, `src/app/actions/social.ts` |
| Fan-out to in-app + Discord / WhatsApp / Signal with verification codes | ✅ adapters (dry-run when unconfigured) | `src/lib/notify/*` |
| Report button → 3 reports auto-hide an invite | ✅ | `reportInvite` |
| Trust score that moves with verdicts | ✅ basic | `shareInvite` |

### What is deliberately stubbed (and which phase replaces it)

| Stub | Production replacement | Phase |
|------|------------------------|-------|
| E-mail-only sign-in | Magic links + OAuth (Auth.js), sessions table | P1 |
| QC + fan-out run inside the request / `after()` | Durable job queue + worker | P3/P4 |
| Without an AI key, every clean link is **Caution**, never Verified | Configure `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | P3 |
| Channel destinations stored in plaintext | Column-level encryption (KMS) | P6 |
| No moderator UI | Admin/mod console | P6 |
| No automated tests | Unit, integration, e2e, QC eval set | P7 |
| In-memory bootstrap seed | Migrations + seed script | P0 |

### Turning on the real integrations

* **AI QC:** set `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`). Any OpenAI-compatible endpoint works via `OPENAI_BASE_URL`.
* **Discord:** works out of the box: the user pastes a webhook URL; a verification code is posted into that channel.
* **WhatsApp:** `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME` (Meta Cloud API; templates must be approved).
* **Signal:** `SIGNAL_API_URL` + `SIGNAL_SENDER` pointing at a self-hosted `signal-cli-rest-api`.
* Set `NOTIFY_DRY_RUN=true` to never call any external service.

See `.env.example` for every variable.
