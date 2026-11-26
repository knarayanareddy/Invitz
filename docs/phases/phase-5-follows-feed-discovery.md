# Phase 5 — Follows, Feed & Discovery

**Goal:** people find events and curators they care about, and the feed gets more relevant over time.
**Duration:** ~2 weeks · **Prereqs:** Phases 2–4.

## Prototype status
| Item | State |
|---|---|
| Follow/unfollow, bell toggle, follower counts | ✅ |
| Feed tabs: All / My communities / Following | ✅ |
| People directory with search (ILIKE) | ✅ |
| Profile page listing a user's invites | ✅ |
| Ranking, past-event handling, search, saved events, calendar, geo, pagination, trending, suggestions | ❌ → this phase |

---

## Step-by-step

### 5.1 Feed correctness first
1. **Keyset pagination:** order by `(created_at DESC, id DESC)`; cursor = `base64(created_at|id)`; "Load more" via a server action or route handler; infinite scroll optional.
2. **Event time awareness:** add filters *Upcoming (default) / This week / Past*. Sort option *Soonest first*. Past events collapse into an archive and are never pushed.
3. Partial index: `CREATE INDEX invites_pub_idx ON invites (created_at DESC, id) WHERE status='published';`
4. Cache anonymous landing feed for 30 s (`unstable_cache` with tag `feed`, revalidate on new invite).
5. Hide invites from users you block (P6) and from sharers whose trust score < 20 unless you follow them.

### 5.2 Relevance ranking (start simple, measurable)
Score = recency decay × (interest match + follow boost + trust boost + engagement) − penalties.

```
score = exp(-age_hours/48)
      * (1 + 0.6*matches_my_interests + 1.0*followed_sharer + 0.3*trust_score/100 + 0.4*log1p(opens))
      * (verdict = 'caution' ? 0.5 : 1)
```
1. Implement as SQL in `lib/queries.ts` behind `?sort=relevant|new`; keep chronological as the default until metrics prove ranking helps.
2. Log impressions/opens/clicks (`interaction_events`: `user_id, invite_id, type, at`) — privacy-light, deletable.
3. Add an **explanation chip** ("Because you follow @maya", "Popular in ML Engineers") — builds trust in the feed.
4. A/B the ranker via a flag; success = higher click-through without lower D7 retention.

### 5.3 Follow graph features
1. **Suggestions:** people with the most Verified shares in my communities in 30 days; people followed by people I follow (2nd-degree).
2. **Per-follow settings** beyond the bell: "only when verified", "only in these communities".
3. **Follow approvals** for private profiles (setting from P1).
4. **Followers/following lists** with pagination; remove follower.
5. **Curator pages:** top curators leaderboard per community (by verified shares and positive engagement, not by volume — avoids rewarding spam).

### 5.4 Search
1. **Events:** Postgres FTS — `ALTER TABLE events ADD COLUMN search tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(location,''))) STORED;` + GIN index. Query with `websearch_to_tsquery`.
2. **People & groups:** `pg_trgm` GIN indexes on `handle`, `display_name`, `groups.name` for typo-tolerant search.
3. Unified search page `/search?q=` with tabs *Events | People | Groups*; show Verified first.
4. Later (if needed): Meilisearch/Typesense with a sync job; keep Postgres as truth.

### 5.5 Saved events, reminders, calendar
1. `saved_events(user_id, event_id, created_at)` and a "Save" button; `/saved` page.
2. **Reminders:** `event_reminders(user_id, event_id, remind_at)` default T-24 h and T-1 h; scheduled `notify.reminder` jobs use the user's channels and quiet hours.
3. **Add to calendar:** generate `.ics` (RFC 5545) server-side at `/api/events/[id]/ics`; plus Google/Outlook deep links. Include the original URL in `DESCRIPTION`.
4. "Going/Interested" (private counters only, no RSVP semantics in v1) to inform ranking.

### 5.6 Location & online/in-person
1. Geocode `events.location` asynchronously (Nominatim/Mapbox) → `lat/lng`, `city`, `country`; cache by string.
2. User preference: home city + radius, "include online events".
3. Filters: *Online | In person near me | Anywhere*. Use PostGIS (`earthdistance` or `postgis`) for radius.

### 5.7 Public, shareable invite pages
1. `/invites/[id]` is publicly viewable for public-group invites; add OG/Twitter meta (title, description, image) so Invitz links preview well in other chat apps.
2. `robots`: `index` only Verified public invites; `noindex` for Caution/Blocked/private.
3. Server-render with `generateMetadata`; sign image URLs through the image proxy.

### 5.8 Tests & metrics
* Unit: ranking score function; ICS output (validated by an RFC parser); cursor encode/decode.
* Integration: pagination has no duplicates/gaps under concurrent inserts; saved + reminder scheduling across DST changes.
* Perf: feed query p95 < 100 ms at 1 M invites (seed script); `EXPLAIN` reviewed.
* Product metrics dashboard: feed CTR, saves per user, reminder → click, follows per week.

---

## Acceptance criteria
- [ ] Feed paginates smoothly with no repeats; default hides past events
- [ ] Search returns relevant events/people/groups in < 200 ms
- [ ] `.ics` opens correctly in Google, Apple, Outlook calendars
- [ ] Reminders fire at the right local time (including DST)
- [ ] Ranking can be switched off by a flag and its effect is measurable

## Risks
| Risk | Mitigation |
|---|---|
| Ranking creates filter bubbles / favours spam | Penalise Caution, reward verified + engagement; keep chronological option |
| Geocoding rate limits/costs | Cache; batch; fall back to city extracted by AI |
