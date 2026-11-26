# Phase 4 — Notifications (In-app, Discord, WhatsApp, Signal)

**Goal:** the right people hear about the right invites on the channel they chose, once, reliably, and can stop it any time.
**Duration:** ~3 weeks · **Prereqs:** Phase 3 (async worker) · **Depends on:** Meta Business verification (start in week 1: it takes days to weeks), a Discord test server, a spare phone number for Signal.

## Prototype status
| Item | State | File |
|---|---|---|
| Audience resolution + dedupe (groups ∪ followers − sharer) | ✅ | `notify/dispatch.ts` |
| In-app notifications + unread badge + "mark all read" | ✅ | `/notifications` |
| Adapter interface + Discord / WhatsApp / Signal adapters | ✅ (dry-run if unconfigured) | `notify/adapters.ts` |
| Channel verification by one-time code *sent through the channel* | ✅ | `settings.ts`, `sendVerificationCode` |
| Gate: only Verified pushed externally unless user opts in per channel | ✅ | `dispatch.ts` |
| Mute a group; bell per followed person | ✅ | |
| Delivery log per notification (status/attempts/error) | ✅ | `notifications` |
| Queue, retries, rate limits, digests, quiet hours, STOP handling, e-mail, templates | ❌ → this phase |

---

## Step-by-step

### 4.1 Move delivery onto the queue
1. Jobs (pg-boss): `notify.fanout(inviteId)` → resolves audience in pages of 500 → enqueues `notify.deliver(notificationId)` per external row.
2. `deliver` loads row + channel, calls the adapter, updates `status/attempts/error/sent_at`. **Idempotency:** unique index on `(invite_id, user_id, channel, channel_id)` so a retried fan-out cannot double-send.
3. Retry policy: network/5xx/429 → exponential backoff (30 s, 2 m, 10 m, 1 h), max 5, honour `Retry-After`. 4xx permanent (invalid destination) → `failed`, increment `channels.failure_count`; after 5 consecutive failures set `enabled=false` and tell the user in-app.
4. Provider-level rate limiters: Discord webhook ≈ 30 req/min per webhook; WhatsApp tier limits; Signal ≈ 1 msg/s per sender. Implement a token bucket per adapter (Redis) and per destination.
5. Dead-letter view in the admin console (P6) with "retry" and "discard".

### 4.2 Discord
1. **v1 (built): user-provided webhook.** Validate the regex, post a code to verify. Pros: no bot hosting, user controls the destination (their own server/channel).
2. Format as an **embed** (title, description, URL, colour: green verified / amber caution, footer "Shared by @handle in Founders"). Disable mentions (`allowed_mentions: {parse: []}`, exists).
3. Handle `404/401` → webhook deleted → mark channel broken. Handle `429` using `retry_after`.
4. **v2: Invitz Discord bot** (OAuth2 "Add to server" + slash commands `/invitz subscribe #founders`) so whole servers can subscribe to communities; and DM delivery via bot after OAuth2 `identify` consent. Requires a bot token, intents review, and hosting a gateway-less interactions endpoint (HTTP interactions) so it fits serverless.

### 4.3 WhatsApp (Meta Cloud API)
1. **Business setup (start early):** create a Meta Business account → verify the business → add a WhatsApp Business Account + phone number → display-name approval → generate a **permanent system-user token**.
2. **Templates:** submit
   * `invitz_verify_code` — *Authentication* category (OTP with copy-code button).
   * `invitz_new_invite` — *Utility* category: "{{1}} shared an event with you: {{2}} · {{3}}. Details: {{4}}". Keep marketing language out; utility templates must be about something the user asked for (they did: subscribed).
   * `invitz_digest` — daily digest (utility).
3. Switch the adapter to send **template messages** for everything outside a 24-hour customer-service window (`WHATSAPP_TEMPLATE_NAME` exists as a single-template placeholder; generalise to a map by message kind).
4. **Webhook endpoint** `/api/webhooks/whatsapp`: verify `X-Hub-Signature-256` (HMAC with app secret) and the GET challenge; handle delivery statuses (`sent/delivered/read/failed`) → update `notifications.status`; handle inbound **STOP/UNSUBSCRIBE** → disable the channel and confirm.
5. **Opt-in record:** store `opted_in_at`, `opt_in_source='settings_otp'`, and the exact consent text version. Provide an opt-out in every message footer ("Reply STOP").
6. **Quality-rating protection:** low read/block rates reduce messaging limits. Therefore: verified-only by default, per-user daily cap (default 5), digest mode, easy STOP, never message unverified numbers.
7. Cost control: one template message ≈ chargeable event; prefer digest as the default for users in > 3 communities.

### 4.4 Signal (best-effort beta)
1. Deploy `bbernhard/signal-cli-rest-api` (Docker, `MODE=json-rpc`) on a small VM with a **persistent volume**; register a dedicated number (SMS/voice verification + captcha). Never reuse a personal number.
2. Lock down the REST API: private network only; the Next.js worker reaches it via `SIGNAL_API_URL`; require a shared secret header via reverse proxy.
3. Verification: send the OTP (exists). Because recipients must be Signal users, handle "unregistered number" errors → friendly message.
4. Throttle ≤ 1 msg/s, ≤ 5 messages/user/day; jitter between sends. Expect occasional rate-limit challenges — keep a runbook for re-registration.
5. Mark the channel **Beta** in the UI; kill-switch env `SIGNAL_ENABLED=false`.
6. Alternative that avoids ToS grey area: a **user-initiated bot flow** (user messages the Invitz number first, then we reply) — lower risk but still unofficial.

### 4.5 Preferences, digests, quiet hours
1. Table `notification_preferences(user_id, timezone, quiet_start, quiet_end, daily_cap, digest_mode)`; and per-channel `digest_mode` (`instant | hourly | daily | weekly`).
2. **Priority rules:** follow-bell invites from people you follow are *instant*; community invites follow your digest setting; muted groups never notify.
3. **Digest job** (cron per timezone): groups pending notifications into one message (top 5 by relevance, link to the app for the rest). Idempotent: marks included rows `sent`.
4. **Quiet hours:** hold `pending` rows until the window ends (scheduled `deliver` with `startAfter`).
5. **Daily cap:** count today's external sends; overflow rolls into the next digest.
6. **Relevance filter:** optional per-channel rule "only invites in these communities / from these people / within X km" (location arrives in P5).

### 4.6 E-mail adapter (free, high reliability)
1. Add `email` to `ChannelType`, adapter using Resend/Postmark with List-Unsubscribe headers and a plain-text alternative.
2. Verify by magic link instead of code. Weekly digest as default.
3. This also becomes the **fallback** when WhatsApp/Signal fail repeatedly.

### 4.7 In-app experience
1. Real-time: SSE (`/api/stream`) or Postgres `LISTEN/NOTIFY` to update the bell badge live.
2. Notification centre filters: *All / Unread / From people / From communities*.
3. Web push (PWA) via `web-push` as another adapter (optional, P9).
4. Show a **delivery log** (exists on `/notifications`) so users can see "why didn't I get that?"

### 4.8 Message content & safety
* Content = title, when/where, sharer's note (escaped, length-limited), sharer + reason, the Invitz link first (so the verdict/QC report is one tap away), the original link second.
* **Caution invites** (opt-in only) are prefixed "⚠️ Unverified — proceed with caution" (exists).
* Never include the sharer's e-mail/phone; never auto-generate mentions.

### 4.9 Tests
* Unit: audience resolver (dedupe, mute, bell off, sharer excluded), channel gating by verdict + `includeUnverified`, message formatter.
* Contract tests per adapter against recorded fixtures/mock servers (Discord 204/404/429, WhatsApp 200/131047/131026, Signal 201/400).
* Integration: fan-out of 2 000 recipients completes; kill the worker mid-way and resume → no duplicates (idempotency).
* Manual QA matrix: each channel × (verify, deliver verified, caution opt-in, STOP, pause, remove, wrong code, expired code).

---

## Acceptance criteria
- [ ] A Verified invite reaches in-app + every verified channel of every audience member exactly once
- [ ] Unverified invites are never pushed externally unless that channel opted in
- [ ] p95 share-to-first-notification < 60 s
- [ ] STOP on WhatsApp disables the channel within seconds
- [ ] Retried jobs never double-deliver (proved by test)
- [ ] Quiet hours, daily cap and digest modes work across time zones (test with 3 zones)
- [ ] Meta templates approved; Signal runbook written

## Risks
| Risk | Mitigation |
|---|---|
| Meta business verification delay | Start day 1 of the project; ship Discord + e-mail first |
| WhatsApp quality rating drop | Verified-only default, caps, digests, STOP |
| Signal instability | Beta label, kill-switch, e-mail fallback |
| Notification fatigue → churn | Digest by default for broad communities; instant only for people you follow |
