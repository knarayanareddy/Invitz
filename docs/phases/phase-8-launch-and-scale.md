# Phase 8 — Launch & Scale

**Goal:** go from private alpha to public launch with healthy communities, reliable operations, and a plan for growth.
**Duration:** ~2 weeks of launch engineering + ongoing · **Prereqs:** Phase 7 go/no-go passed (alpha can start after Phase 4).

## Staged rollout

| Stage | When | Who | Goal | Exit criteria |
|---|---|---|---|---|
| **Internal dogfood** | after P3 | team | QC sanity, fix obvious bugs | 100 real shares reviewed, no critical bugs |
| **Private alpha** | after P4 (~wk 10) | 30–100 invited users in 3–4 seed communities (e.g. ML engineers, climate founders, VCs) | prove share → notify → click loop; collect labelled QC data | ≥ 40 % weekly active; Verified precision ≥ 98 % on reviewed samples; notification delivery ≥ 98 % |
| **Closed beta** | after P6 | 500–2 000, waitlist + referral | stress test moderation + costs | stable ops 2 weeks; appeals SLA met; cost/share within budget |
| **Public launch** | after P7 | open sign-ups | growth | go/no-go checklist green |

## Step-by-step

### 8.1 Production infrastructure
1. **Topology:** web (2 instances, autoscale), worker (2 instances: `qc` queue + `notify` queue), Postgres (primary + PITR; read replica when read load demands), Redis (rate limits), object storage (avatars), CDN (images/static), egress proxy (fetcher).
2. **Infrastructure as Code** (Terraform/Pulumi or the host's config); reproducible staging.
3. **Zero-downtime deploys:** expand/contract migrations; health-gated rollout; instant rollback to previous image; feature flags for risky features.
4. **Secrets:** per-environment; automated rotation reminders; no developer has prod DB write access by default (break-glass with audit).
5. **Domains & e-mail:** `invitz.app` (web), `mail.invitz.app` with SPF/DKIM/DMARC, `bot.invitz.app` for the fetcher user-agent info page.

### 8.2 Observability & alerting
1. **Dashboards:** request latency/error rate; share funnel; QC verdict mix (Verified/Caution/Blocked %), AI latency/error/cost; queue depth and age; delivery success per channel; WhatsApp quality rating; DB CPU/connections/slow queries.
2. **SLOs:** share→verdict p95; share→notification p95; delivery success; web availability. Burn-rate alerts to on-call.
3. **Alerts (page):** AI breaker open > 5 min; queue age > 5 min; delivery failure rate > 5 %; error budget burn; DB disk > 80 %. **(ticket):** Verified-then-reported rate > 1 %; cost > budget; WhatsApp quality "medium/low".
4. **Tracing:** one trace id from share → QC → fan-out → delivery (OpenTelemetry).
5. **Product analytics:** funnel (visit → sign-up → interests → channel → first share → first click), cohort retention, notification → click, per-community health.

### 8.3 Operations & reliability
1. **Backups:** PITR enabled; **restore drill** quarterly (document the time to restore).
2. **Runbooks** (`docs/runbooks/`): AI outage (breaker → Caution mode, comms template), channel outage, spam wave (tighten thresholds, disable open topic posting, raise review sampling), data leak, rotate secrets, mass-notification mistake (kill switch `NOTIFY_DISABLED`), Signal re-registration.
3. **Kill switches (flags):** disable external notifications; disable a single channel; force rules-only QC; read-only mode; pause sign-ups.
4. **On-call:** rota, escalation, incident template, blameless postmortems.
5. **Capacity & cost reviews:** monthly — AI cost/share, WhatsApp cost/click, DB growth, queue throughput.

### 8.4 Scaling playbook (do the cheap thing first)
| Symptom | Fix |
|---|---|
| Feed slow | Indexes → keyset → cached anon feed → read replica → materialised "hot" feed per community |
| Fan-out slow for big communities | Shard fan-out jobs by 500 recipients, parallel workers; precompute community audiences; digest-by-default for communities > 5 k |
| AI cost high | QC cache by URL+content hash; tiered models; skip AI for known-good domains with consistent history *when rules are clean and the page is unchanged*; rate-limit new accounts |
| Notification cost high (WhatsApp) | Digest default; per-user caps; push users toward free channels; charge/limit for power sharers (P9) |
| DB hot tables | Partition `notifications`, `qc_checks` by month; archive to cold storage |
| Worker contention | Separate queues & concurrency per job type; move to a dedicated queue (SQS/BullMQ) if pg-boss becomes the bottleneck |

### 8.5 Community seeding & growth (the cold-start plan)
1. **Pick 3–5 seed communities** and recruit 2–3 organisers/curators each *before* launch (people who already post events in Slack/WhatsApp groups). Offer: a curated profile, early-access, and their audience can subscribe by one link.
2. **Import friction removers:** "Invite your circle" link, bulk follow suggestions, e-mail digest as the lightest first touch.
3. **Content flywheel:** day-1 content from curators + weekly "Best of Invitz" digest.
4. **Shareable invite pages** with great previews so every share is a growth surface (P5.7).
5. **Referral:** unlock custom group creation size / priority features when invitees join (no cash incentives that attract spam).
6. **Partnerships:** meetup organisers, university societies, accelerators; offer verified-organiser badges (P9).
7. Success tracking per community: weekly active members, shares per member, share→click, Verified ratio, report rate.

### 8.6 Customer support & trust
* Help centre: "Why was my invite blocked?", "What does Caution mean?", "Connect WhatsApp/Signal/Discord", "Delete my account".
* In-product feedback button; support e-mail with SLA; public status page; changelog; transparency report (QC volumes, appeal outcomes).

### 8.7 Monetisation options (decide after traction; design now, build later)
* **Free:** core sharing + in-app + Discord + e-mail.
* **Pro curators / organisers:** higher group sizes, scheduled posts, analytics, verified-organiser badge, WhatsApp digests included.
* **Community/Org plans:** private branded communities, SSO, moderation tools.
* **Sponsored placements:** clearly labelled, QC'd by the same rules; never mixed into Verified without a "Sponsored" tag.
* Keep entitlements in one `plans`/`entitlements` module so pricing changes are config.

### 8.8 Launch checklist
- [ ] Go/no-go meeting passed (Phase 7.7)
- [ ] Load test at 3× expected day-1 traffic
- [ ] Status page + support inbox live; on-call rota published
- [ ] Meta templates approved; Signal marked Beta; Discord working
- [ ] Rate limits and kill switches tested in production
- [ ] Seed communities active with ≥ 20 curated Verified invites
- [ ] Press/community announcement with a clear "how QC works" explainer

---

## Acceptance criteria
- [ ] Alpha exit criteria met before beta; beta exit before public
- [ ] Dashboards and alerts exist for every SLO; a game-day (simulated AI outage + channel outage) passes
- [ ] Restore drill completed with documented RTO/RPO
- [ ] Unit economics known: cost per share and per notification vs. engagement

## Risks
| Risk | Mitigation |
|---|---|
| Empty communities at launch | Curator recruitment + seeded content + digests |
| Viral spam wave after launch | Waitlist throttle, tightened QC mode, new-account limits, kill switches |
| Cost overrun | Daily caps, alerts, digest default |
