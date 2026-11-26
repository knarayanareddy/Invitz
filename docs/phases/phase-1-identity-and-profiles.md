# Phase 1 — Identity, Profiles & Onboarding

**Goal:** people can sign up securely, build a profile, mark interests, and understand the product in under two minutes.
**Duration:** ~1.5 weeks · **Prereqs:** Phase 0 · **Depends on:** e-mail provider (Resend/Postmark), OAuth app registrations.

## Prototype status
| Item | State |
|---|---|
| E-mail-only sign-in with signed cookie | ✅ *insecure by design* (anyone can claim any e-mail) |
| Profile (name, headline, bio), handle | ✅ (`/settings`) |
| Interests ↔ topic communities | ✅ (`saveInterests`) |
| Public profile page w/ follow counts | ✅ (`/people/[handle]`) |
| Real auth, sessions, handle editing, avatar, account deletion | ❌ → this phase |

Because pages only call `getCurrentUser()` / `requireUser()` / `createSession()` / `destroySession()` from `src/lib/auth.ts`, replacing the implementation does not touch any page.

---

## Step-by-step

### 1.1 Real authentication (Auth.js v5)
1. Install: `npm i next-auth@beta @auth/drizzle-adapter`.
2. Add Auth.js tables to `schema.ts`: `accounts`, `sessions`, `verification_tokens` (adapter schema). Generate + review migration.
3. Configure providers in `src/auth.ts`:
   * **E-mail magic link** (via Resend): 10-minute single-use tokens.
   * **Google**, **GitHub**, **LinkedIn** (relevant for founders/VCs) OAuth.
4. Use **database sessions** (revocable) with 30-day sliding expiry; cookie `HttpOnly; Secure; SameSite=Lax`.
5. Rewrite `src/lib/auth.ts` to wrap `auth()`; keep the same exported function names. Delete the `login` demo action (keep a `DEMO_LOGIN=true` dev-only switch for seeded users).
6. Link accounts by **verified e-mail** only. If a provider returns an unverified e-mail, don't auto-link.
7. Middleware/`proxy.ts`: protect `/share`, `/settings`, `/notifications`; redirect to `/login?next=…` and honour `next` after sign-in (validate it's a relative path → avoid open redirect).

### 1.2 Abuse controls at the door
1. Add **Cloudflare Turnstile** to the sign-up/magic-link form.
2. Rate limit magic-link requests: 5 / hour / e-mail, 20 / hour / IP (Upstash Ratelimit).
3. Block disposable e-mail domains (maintained list) for *share* privileges; allow browsing.
4. **New-account throttle:** accounts < 24 h old can share to at most 3 audiences and 3 invites/day (extend the `rate_limit` rule to read account age and `trust_score`).

### 1.3 Onboarding flow (3 screens, skippable)
1. **Welcome:** one sentence on how Invitz works + the 3 verdict badges explained.
2. **Interests:** multi-select topic chips (min 1) → auto-join communities (already implemented).
3. **Connect a channel (optional):** Discord / WhatsApp / Signal / e-mail; explain *"we only push Verified invites"*.
4. **Follow suggestions:** top curators in the chosen communities (query: most Verified shares in 30 days).
5. Track funnel events: `signup_started`, `signup_completed`, `interests_selected`, `channel_verified`, `first_share`.

### 1.4 Profile features
1. **Handle rules:** 3–20 chars `[a-z0-9_]`, reserved words (`admin`, `support`, `invitz`, …); allow one change per 30 days; keep old handle redirect for 90 days.
2. **Avatar:** upload to object storage (S3/R2) with signed URLs; resize server-side (sharp) to 256×256; strip EXIF; fallback to initials (exists).
3. **Links & credentials (optional):** website, LinkedIn, organisation. Show "verified organiser" later via domain-verification (P9).
4. **Privacy settings:** profile visibility (public/members only), "show my follower count", "allow follows" (auto/approve).
5. **Interests UX:** allow free-form tags later (P9); for now curated topics keep communities healthy.
6. **Sessions page:** list devices, "sign out everywhere".

### 1.5 Account lifecycle
1. **Export my data** (JSON zip: profile, invites, follows, notifications).
2. **Delete my account:** confirmation by e-mail → soft delete → 30-day grace → hard delete (cascade). Their invites are removed; reports against them are retained anonymously.
3. **Email change:** verify new address first.

### 1.6 Tests
* Unit: handle validation, reserved words, `next` redirect sanitiser.
* Integration: sign-up creates user + auto-joins `general`; saving interests syncs memberships (add/remove).
* e2e: sign in via magic link (use a test inbox), complete onboarding, edit profile.
* Security: session fixation, cookie flags, CSRF on server actions, open-redirect.

---

## Acceptance criteria
- [ ] No one can sign in as another person without owning the e-mail/OAuth account
- [ ] A new user reaches a populated feed within 3 clicks of sign-up
- [ ] Sessions are revocable; "sign out everywhere" works
- [ ] Handle uniqueness is enforced case-insensitively (unique index on `lower(handle)`)
- [ ] Export and delete work end-to-end
- [ ] Rate limits trigger and show friendly errors

## Risks
| Risk | Mitigation |
|---|---|
| Auth.js v5 still in beta | Pin the version; wrap in `lib/auth.ts`; or choose Clerk/Lucia |
| Social login returns unverified e-mails | Reject auto-link; require magic link confirmation |
