# Phase 2 — Groups & the Sharing Flow

**Goal:** a user can share any event link to a wide audience, topic communities, or a custom group, and everyone sees the right things.
**Duration:** ~2 weeks · **Prereqs:** Phase 1 (auth) · QC hooks are wired but the full engine lands in Phase 3.

## Prototype status
| Item | State |
|---|---|
| `general` ("Everyone") + 10 topic communities | ✅ seeded |
| Custom groups (private/public), add/remove by @handle, mute | ✅ |
| Share form (URL, note, multi-audience) | ✅ (`/share`) |
| Event upsert by canonical URL + metadata extraction | ✅ |
| Visibility rule (public vs member-only) | ✅ (`visibleTo`) |
| Invite links, join requests, group roles/rules, edit/delete invite, drafts | ❌ → this phase |

---

## Step-by-step

### 2.1 Harden the group model
1. **Roles:** extend `group_members.role` to `owner | moderator | member`. Moderators can remove members/posts.
2. **Group settings:** `posting_policy` (`anyone | members | approved`), `join_policy` (`open | request | invite`), `rules_text` (shown before first post).
3. **Join links:** `group_invites(code, group_id, created_by, expires_at, max_uses, uses)`. Route `/groups/join/[code]`; show group preview + rules; one-click join.
4. **Join requests:** `group_join_requests`; owner approves in the sidebar.
5. **Ownership transfer** and "owner can't leave without transferring".
6. **Size limits:** max 500 members for custom groups in v1 (protects notification cost); raise by trust tier.
7. **Topic communities:** owned by the platform, moderated by volunteers (P6). Users can *propose* new topics (P9).

### 2.2 Share flow UX
1. Make `/share` accessible from anywhere: nav button, group page ("Share to this group"), PWA Web Share Target (`manifest.webmanifest` → `share_target`), and a bookmarklet.
2. **Live link preview** before submission: server action `previewLink(url)` returns title/image/date using the same `fetchPage` (no AI) so the sharer sees what the audience will see. Debounce 600 ms; cancel stale requests.
3. **Audience picker** upgrades: search, recent audiences, "same as last time", per-audience member counts, warning when selecting > 3 broad communities ("Too broad lowers relevance, pick the most relevant").
4. **Note guidance:** 500-char limit counter, example prompts ("who is this for?", "what's the takeaway?").
5. **Progress UI:** the QC step takes seconds — show the checklist ("Opening page… Checking rules… AI review…") using `useActionState` pending state now, and streamed status (SSE) once QC is async (P3).
6. **Result page** (`/invites/[id]`): verdict, confidence bar, findings, what to fix if blocked, "Share again" shortcut. (exists)
7. **Edit within 10 minutes:** edit note/audiences; any change to audiences re-runs QC; link changes require a new invite.
8. **Delete/retract:** sharer can delete → status `retracted`; remove from feeds; (optional) send "cancelled" notification to people who were notified.

### 2.3 Events: normalisation & enrichment
1. Canonical URL rules (exists): lowercase host, strip `utm_*`, `fbclid`, `gclid`, hash; sort params. Add per-host rules (e.g. Eventbrite `?aff=`, Meetup `?eventOrigin=`), kept in a config table.
2. Extraction priority: JSON-LD `Event` → OpenGraph/meta → AI-extracted → fallback to host. Persist `extraction_source` for debugging.
3. **Time zones:** store UTC; if JSON-LD has an offset keep `timezone` text; display in the viewer's zone with the organiser's zone in a tooltip.
4. **Recurring/multi-day:** support `ends_at`; treat recurring as separate events by URL.
5. **Online vs in-person:** `attendance_mode` enum-as-text; show badges; location geocoding in P5 for "near me".
6. **Image safety:** never hot-link unknown images into the feed without the proxy (privacy + mixed content); use a resizing proxy with allow-list of content types (P6).
7. **Event update checks:** daily job re-fetches upcoming events; if the page 404s or the date changes, update the event and flag invites (ties into P6 link-rot).

### 2.4 Authorisation & visibility
1. Centralise all permission checks in `src/lib/permissions.ts` (`canPostTo(user, group)`, `canView(user, invite)`, `canModerate(user, group)`). Actions must call these and never inline logic.
2. Keep `visibleTo` as the **only** read filter; add a test that creates private/public/blocked invites and asserts what each viewer sees.
3. Add Postgres RLS later (P6) as defence in depth.

### 2.5 Error handling and states
* Typed result objects (`{ ok: true, … } | { ok: false, code, message }`) from `lib/*`; actions map to UI messages.
* Per-route `loading.tsx`, `error.tsx`; empty states with a call to action (exists on feed, group, profile).
* Form errors announced with `role="alert"` (exists) and field-level messages.

### 2.6 Tests
* Unit: canonicalisation corpus (50 real URLs from Luma, Eventbrite, Meetup, Hopin, university pages, conference sites).
* Integration: share to custom group requires membership; public topic groups allow anyone; duplicate rule; visibility matrix.
* e2e: create a group → add member → share → member sees it; non-member doesn't.

---

## Acceptance criteria
- [ ] A user can share any https link to ≥ 1 audience in < 30 s
- [ ] Private-group invites never appear to non-members (automated matrix test)
- [ ] The same event shared by two people yields **one** `events` row and two invites
- [ ] Group roles and join links work; expired/used-up links are rejected
- [ ] A shared event renders with title/date/location where the page provides them

## Risks
| Risk | Mitigation |
|---|---|
| Pages that are JS-rendered return empty HTML | Fall back to AI on the note + URL (lower confidence → Caution); later add a headless-render fetcher behind a flag |
| Over-broad audience selection becomes spam | Soft warning + per-group daily post caps (P6) |
