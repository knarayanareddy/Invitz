# 03 — Gaps & Best-Practice Checklist

Things you did **not** mention but a real product needs. Each row says where it is handled. ✅ = in the prototype, 🟡 = partially, 📋 = planned in the phase shown.

## A. Product gaps

| Area | Gap | Resolution | Status |
|---|---|---|---|
| **Onboarding** | New users land in an empty app | After sign-in → settings with interest picker; auto-join communities; suggested people to follow | 🟡 P1/P5 |
| **Event lifecycle** | Past events clutter the feed | Parse `startDate`; hide/mark *Past* after end; "Upcoming" default filter; archive page | 📋 P5 |
| **Event details** | Date, place, image are needed to be useful | OpenGraph + JSON-LD + AI extraction; editable by sharer within 10 min | ✅ extraction / 📋 edit |
| **Calendar** | People want to add to calendar | `.ics` download + Google/Outlook links | 📋 P5 |
| **Reminders** | Notify me before it starts | `saved_events` + scheduled job | 📋 P5 |
| **Duplicates** | Same event shared 10× | Canonical URL; per-group 7-day duplicate block; "also shared by…" on card | ✅ block / 📋 merge UI |
| **Targeting precision** | Spamming everyone is the failure mode | Per-group mute, daily caps, digest mode, relevance score | 🟡 mute ✅ / 📋 P4/P5 |
| **Search & discovery** | Find events, people, groups | Postgres FTS + trigram; "trending in my communities" | 🟡 people search ✅ / 📋 P5 |
| **Group governance** | Who can post in a public community? | Roles (owner/mod/member), group rules, post approval mode for new members | 📋 P2/P6 |
| **Private-group invitations** | Joining by handle only is clumsy | Invite links with expiry + requests to join | 📋 P2 |
| **Blocking & muting** | Harassment control | `user_blocks`; blocked users never appear/notify | 📋 P6 |
| **Appeals** | Wrongly blocked invites | Appeal form → moderator queue → SLA 48 h | 📋 P6 |
| **Reporting** | Community safety net | Report reasons, auto-hide at threshold | ✅ basic / 📋 mod console |
| **Reputation** | Reward good curators | Trust score affects QC strictness (high trust → fewer warns; low → manual review) | 🟡 score ✅ / 📋 P6 |
| **E-mail channel** | Many users prefer e-mail; free; WhatsApp cost | E-mail adapter + weekly digest | 📋 P4 |
| **Digest mode** | Reduce notification fatigue and cost | Hourly/daily/weekly batching per channel | 📋 P4 |
| **Quiet hours / time zones** | Don't ping at 3 am | `notification_preferences` with TZ | 📋 P4 |
| **Notification controls** | Per-topic/per-group/per-person | Preference matrix UI | 🟡 P4 |
| **Unsubscribe / STOP** | Legal + platform requirement | Reply STOP on WhatsApp/Signal, one-click links, in-app toggles | 📋 P4 |
| **Languages** | Events are multilingual | AI extracts language; i18n of UI (next-intl) | 📋 P7/P9 |
| **Shareable links & SEO** | Invite pages should preview well | Public invite pages with OG tags, `noindex` for caution/blocked | 📋 P5 |
| **Browser extension / share target** | "Share to Invitz" from anywhere | PWA Web Share Target + extension calling the API | 📋 P9 |
| **Bulk/ongoing sources** | Organisers publish many events | RSS/iCal import with QC per item | 📋 P9 |

## B. Trust, safety & security

| Item | Resolution | Status |
|---|---|---|
| SSRF in link fetcher | DNS+IP allow-listing, port limits, redirect re-validation, size/time caps | ✅ / 📋 egress proxy P6 |
| Prompt injection | Untrusted-data framing, schema-validated output, injection = spam signal | ✅ |
| Rate limiting (per user/IP/route) | Redis sliding window; today: per-user shares/hour | 🟡 P6 |
| CSRF | Server Actions have built-in origin checks; keep `SameSite=Lax` cookies | ✅ |
| XSS | React escaping; never `dangerouslySetInnerHTML`; scraped text is only rendered as text; CSP header | ✅ / 📋 CSP P6 |
| Outbound links | `rel="noopener noreferrer nofollow ugc"` | ✅ |
| Link-rot / malicious redirects | Re-check URLs of upcoming events daily; downgrade to Caution if page turns bad | 📋 P6 |
| Phishing look-alikes | Punycode and TLD heuristics; Safe Browsing API check | 🟡 / 📋 P6 |
| Secrets management | Env vars, never committed; rotate; per-environment | ✅ / 📋 P0 |
| Destination encryption | AES-GCM + KMS | 📋 P6 |
| Audit logging | `qc_checks` ✅; `audit_log` for admin/security actions | 🟡 P6 |
| Account takeover | Passwordless + device sessions list + revoke | 📋 P1 |
| Bot signups | Turnstile/hCaptcha, e-mail domain checks, new-account throttle | 📋 P1/P6 |

## C. Engineering best practices

| Item | Resolution | Phase |
|---|---|---|
| Migrations | `drizzle-kit generate` + reviewed SQL, never `push` in prod | P0 |
| Environments | local → preview (per PR) → staging → prod; separate DBs/keys | P0 |
| CI | Lint, typecheck, unit, integration (Postgres service), build, e2e smoke | P0 |
| Testing pyramid | Unit (rules, decide, canonicalise) → integration (actions + DB) → e2e (Playwright) → **QC evaluation suite** | P7 |
| Feature flags | Env-based flags first; add Unleash/PostHog flags in P8 | P8 |
| Observability | Structured logs with `request_id`/`invite_id`, Sentry, traces for QC and delivery, dashboards | P0/P8 |
| Error handling | Typed results from `lib`, user-friendly messages, no stack traces to users | P2 |
| Idempotency | Fan-out and delivery keyed on (invite, user, channel) to survive retries | P4 |
| Retries & DLQ | Exponential backoff, max attempts, dead-letter view for ops | P4 |
| Pagination | Keyset | P5 |
| Caching | `qc_cache`, ISR for public pages, CDN for images | P3/P5 |
| Accessibility | Semantic HTML, focus states, contrast, `aria-live` for form errors, keyboard navigation, axe in CI | P7 |
| Performance budgets | LCP < 2.5 s, JS < 150 kB on feed, image proxy/resize | P7 |
| API versioning | `/api/v1`, additive changes only | P9 |
| Docs | ADRs, runbooks, on-call guide | P8 |
| Data-quality | Evaluation set versioned in repo; prompt/model changes need passing the suite | P3/P7 |

## D. Legal, privacy & compliance

| Item | Resolution | Phase |
|---|---|---|
| Terms of Service + Acceptable Use | Defines spam, prohibited content, enforcement | P7 |
| Privacy policy + cookie notice | Lists vendors: AI provider, WhatsApp/Meta, hosting | P7 |
| Consent for messaging | OTP opt-in per channel, logged with timestamp | ✅ OTP / 📋 consent log P4 |
| GDPR rights | Export + delete in settings; DPA with vendors; EU region option | P7 |
| Data minimisation to the AI vendor | Send only URL, note, page excerpt, audience names. Never e-mail, phone, handle | ✅ |
| DSA / notice-and-action (EU) | Report flow + statement of reasons for blocks | P6/P7 |
| Children | 16+ age gate in ToS | P7 |
| Copyright of scraped content | Only short excerpts for classification; images hot-linked/proxied, not re-hosted without rights | P3 |
| WhatsApp Business Policy | Templates, opt-in/out, quality rating monitoring | P4 |

## E. Operations

| Item | Resolution | Phase |
|---|---|---|
| Health checks | `/api/health` ✅; add `/api/ready` with queue/AI status | P0 |
| Backups | Daily PITR snapshots; quarterly restore drill | P8 |
| Cost guardrails | Daily AI-spend cap → degrade to rules-only (= Caution) | P3/P8 |
| Incident playbooks | AI outage, channel outage, spam wave, data leak | P8 |
| Admin console | Guidelines editor, moderation queue, domain blocklist, user lookup | P6 |
| Analytics (privacy-friendly) | PostHog/Plausible: funnel share → open → click | P8 |
| Support | Help centre, contact form, status page | P8 |
