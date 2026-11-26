import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  events,
  follows,
  groupMembers,
  groups,
  inviteGroups,
  invites,
  notificationChannels,
  notificationPreferences,
  notifications,
  qcChecks,
  qcGuidelines,
  topics,
  userInterests,
  users,
  type QcFinding,
  type Verdict,
} from "@/db/schema";
import { encryptSecret, hashDestination, hashVerifySecret } from "@/lib/crypto";

/**
 * Idempotent database seeding (topics, topic communities, QC rulebook, and optional demo data).
 * Can be called via `npm run db:seed` (`scripts/seed.ts`) or lazily on cold start.
 */

const TOPICS = [
  { slug: "ml-engineers", name: "ML Engineers", emoji: "🤖" },
  { slug: "data-scientists", name: "Data Scientists", emoji: "📊" },
  { slug: "climate", name: "Climate Enthusiasts", emoji: "🌍" },
  { slug: "founders", name: "Founders", emoji: "🚀" },
  { slug: "vcs", name: "VCs & Investors", emoji: "💼" },
  { slug: "developers", name: "Software Developers", emoji: "💻" },
  { slug: "designers", name: "Designers", emoji: "🎨" },
  { slug: "product", name: "Product Managers", emoji: "🧭" },
  { slug: "researchers", name: "Researchers & Academia", emoji: "🔬" },
  { slug: "health-bio", name: "Health & Biotech", emoji: "🧬" },
];

const GUIDELINES: (typeof qcGuidelines.$inferInsert)[] = [
  { key: "https_only", scope: "rule", severity: "block", title: "HTTPS only", description: "Links must be served over HTTPS.", sortOrder: 10 },
  { key: "ip_host", scope: "rule", severity: "block", title: "No raw IP links", description: "Links must use a domain name, not a bare IP address.", sortOrder: 20 },
  { key: "blocklisted_domain", scope: "rule", severity: "block", title: "Blocklisted domains", description: "Domains reported as abusive are never accepted.", sortOrder: 30 },
  { key: "scam_language", scope: "rule", severity: "block", title: "No scam language", description: "Financial promises, wallet or credential requests and banned content are blocked.", sortOrder: 40 },
  { key: "rate_limit", scope: "rule", severity: "block", title: "Sharing rate limit", description: "Too many shares in an hour is treated as spam behaviour.", sortOrder: 50 },
  { key: "duplicate", scope: "rule", severity: "block", title: "No duplicate shares", description: "The same event can't be re-shared to the same group within 7 days.", sortOrder: 60 },
  { key: "url_shortener", scope: "rule", severity: "warn", title: "Visible destination", description: "Shortened links hide where they lead, so they get a caution label.", sortOrder: 70 },
  { key: "suspicious_domain", scope: "rule", severity: "warn", title: "Trustworthy domain", description: "Look-alike characters and high-abuse TLDs get a caution label.", sortOrder: 80 },
  { key: "promo_language", scope: "rule", severity: "warn", title: "Tone", description: "Aggressive promotional wording gets a caution label.", sortOrder: 90 },
  { key: "unreachable_page", scope: "rule", severity: "warn", title: "Page must load", description: "If Invitz can't open the page, it can't verify the event.", sortOrder: 100 },
  { key: "weak_event_signals", scope: "rule", severity: "warn", title: "Specific event", description: "The page should show a date or other concrete event details.", sortOrder: 110 },
  { key: "real_event", scope: "ai", severity: "block", title: "Genuine event", description: "The link must lead to a real, specific event (date, place or online session), not a generic homepage or sales funnel.", sortOrder: 200 },
  { key: "no_financial_solicitation", scope: "ai", severity: "block", title: "No financial solicitation", description: "Reject get-rich-quick schemes, crypto giveaways, pump-and-dump or pyramid schemes disguised as events.", sortOrder: 210 },
  { key: "no_harmful_content", scope: "ai", severity: "block", title: "No harmful content", description: "Reject adult, illegal, hateful or harassing content.", sortOrder: 220 },
  { key: "no_impersonation", scope: "ai", severity: "block", title: "No impersonation", description: "Reject pages that impersonate another organiser, brand or person to collect data or payments.", sortOrder: 230 },
  { key: "audience_fit", scope: "ai", severity: "info", title: "Audience fit", description: "Note when the event is clearly irrelevant to the selected audiences.", sortOrder: 240 },
];

const BOOTSTRAP_LOCK_KEY = 42081941;

let booted: Promise<void> | null = null;

export function ensureBootstrap() {
  if (!booted) {
    booted = seedDatabase().catch((err) => {
      booted = null;
      console.error("[bootstrap] failed:", err);
      throw err;
    });
  }
  return booted;
}

export async function seedDatabase(opts: { includeDemo?: boolean } = {}) {
  const includeDemo = opts.includeDemo ?? process.env.INVITZ_DEMO_SEED === "true";

  await db.transaction(async (tx) => {
    // Prevent concurrent cold starts across serverless instances from racing on demo seeding.
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`);

    await tx.insert(qcGuidelines).values(GUIDELINES).onConflictDoNothing();
    await tx.insert(topics).values(TOPICS).onConflictDoNothing();
    const allTopics = await tx.select().from(topics);

    await tx
      .insert(groups)
      .values({
        slug: "general",
        name: "Everyone",
        description: "The wide, generalist audience. Share events anyone might enjoy.",
        type: "general",
        visibility: "public",
      })
      .onConflictDoNothing();
    await tx
      .insert(groups)
      .values(
        allTopics.map((t) => ({
          slug: t.slug,
          name: t.name,
          description: `Events for ${t.name.toLowerCase()}.`,
          type: "topic" as const,
          visibility: "public" as const,
          topicId: t.id,
        })),
      )
      .onConflictDoNothing();

    // Idempotently encrypt any pre-migration plaintext channel destinations or verification codes.
    const rawChannels = await tx.select().from(notificationChannels);
    for (const ch of rawChannels) {
      const needsEncrypt = !ch.destination.startsWith("enc:v1:");
      const needsHash = !ch.destinationHash || ch.destinationHash.startsWith("legacy:");
      const needsCodeHash = Boolean(ch.verifyCode && !ch.verifyCodeHash);
      if (needsEncrypt || needsHash || needsCodeHash) {
        const enc = needsEncrypt ? encryptSecret(ch.destination) : { ciphertext: ch.destination, keyId: ch.destinationKeyId };
        await tx
          .update(notificationChannels)
          .set({
            destination: enc.ciphertext,
            destinationKeyId: enc.keyId,
            destinationHash: needsHash ? hashDestination(ch.type, ch.destination) : ch.destinationHash,
            ...(needsCodeHash && ch.verifyCode
              ? { verifyCodeHash: hashVerifySecret(ch.verifyCode), verifyCode: null }
              : {}),
          })
          .where(eq(notificationChannels.id, ch.id));
      }
    }

    if (!includeDemo) return;
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(users);
    if (count === 0) {
      const demoUsers = [
        { email: "ada@demo.invitz.app", handle: "ada", displayName: "Ada Okafor", headline: "ML engineer · MLOps nerd", bio: "Building ML platforms. I share meetups worth the commute.", interests: ["ml-engineers", "data-scientists", "developers"] },
        { email: "maya@demo.invitz.app", handle: "maya", displayName: "Maya Lindqvist", headline: "Founder, climate-tech", bio: "Cleantech founder. Curating climate and founder events.", interests: ["climate", "founders"] },
        { email: "linus@demo.invitz.app", handle: "linus", displayName: "Linus Park", headline: "Partner at Northgate Ventures", bio: "Early-stage investor. Demo days and founder dinners.", interests: ["vcs", "founders"] },
        { email: "grace@demo.invitz.app", handle: "grace", displayName: "Grace Mwangi", headline: "Data scientist", bio: "Stats, causal inference and good coffee.", interests: ["data-scientists", "researchers"] },
      ];
      await tx
        .insert(users)
        .values(demoUsers.map(({ interests: _i, ...u }) => u))
        .onConflictDoNothing();

      const existingDemoUsers = await tx.select().from(users);
      const uid = new Map(existingDemoUsers.map((u) => [u.handle, u.id]));
      const allGroups = await tx.select().from(groups);
      const gid = new Map(allGroups.map((g) => [g.slug, g.id]));
      const tid = new Map(allTopics.map((t) => [t.slug, t.id]));

      const interestRows = demoUsers.flatMap((u) =>
        u.interests.map((s) => ({ userId: uid.get(u.handle)!, topicId: tid.get(s)! })).filter((r) => r.userId && r.topicId),
      );
      if (interestRows.length) await tx.insert(userInterests).values(interestRows).onConflictDoNothing();

      const memberRows = demoUsers.flatMap((u) =>
        ["general", ...u.interests].map((s) => ({ groupId: gid.get(s)!, userId: uid.get(u.handle)! })).filter((r) => r.groupId && r.userId),
      );
      if (memberRows.length) await tx.insert(groupMembers).values(memberRows).onConflictDoNothing();

      if (uid.has("grace") && uid.has("ada") && uid.has("maya") && uid.has("linus")) {
        await tx
          .insert(follows)
          .values([
            { followerId: uid.get("grace")!, followeeId: uid.get("ada")!, notify: true },
            { followerId: uid.get("linus")!, followeeId: uid.get("maya")!, notify: true },
            { followerId: uid.get("ada")!, followeeId: uid.get("maya")!, notify: false },
          ])
          .onConflictDoNothing();
      }

      const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000);
      const demoInvites: {
        by: string; groups: string[]; verdict: Verdict; confidence: number; note: string; summary: string;
        event: { url: string; host: string; title: string; description: string; startsAt: Date; location: string };
        findings: QcFinding[];
      }[] = [
        {
          by: "ada", groups: ["ml-engineers", "data-scientists"], verdict: "verified", confidence: 0.93,
          note: "Last edition had great talks on feature stores. Worth it if you ship models.",
          summary: "Specific meetup with date, venue and agenda from a recognisable community.",
          event: { url: "https://example.com/events/mlops-berlin", host: "example.com", title: "MLOps Community Meetup — Berlin", description: "Three talks on production ML: feature stores, evaluation, and cost control.", startsAt: hoursFromNow(24 * 9), location: "Factory Berlin Mitte, Berlin" },
          findings: [{ code: "ai_review", severity: "info", source: "ai", message: "Page lists a venue, date and three named speakers." }],
        },
        {
          by: "maya", groups: ["climate", "founders"], verdict: "verified", confidence: 0.88,
          note: "Small, founder-only breakfast. No pitches, just honest war stories.",
          summary: "Clear date, location and organiser; no promotional red flags.",
          event: { url: "https://example.org/climate-founders-breakfast", host: "example.org", title: "Climate Founders Breakfast", description: "A relaxed breakfast for early-stage climate-tech founders.", startsAt: hoursFromNow(24 * 4), location: "Stockholm" },
          findings: [{ code: "ai_review", severity: "info", source: "ai", message: "Event page has concrete date, city and a named host." }],
        },
        {
          by: "linus", groups: ["vcs", "founders"], verdict: "caution", confidence: 0.52,
          note: "Seed-stage demo night, 8 slots left for founders.",
          summary: "We couldn't verify this invite with confidence. It might be spam or inaccurate — please proceed with caution.",
          event: { url: "https://example.net/seed-demo-night", host: "example.net", title: "Seed Investors Demo Night", description: "Pitch to a room of seed investors.", startsAt: hoursFromNow(24 * 12), location: "London" },
          findings: [
            { code: "unreachable_page", severity: "warn", source: "rule", message: "Invitz couldn't open the page (page responded with HTTP 503)." },
            { code: "ai_review", severity: "warn", source: "ai", message: "Not enough information on the page to confirm the event is real." },
          ],
        },
        {
          by: "grace", groups: ["general"], verdict: "caution", confidence: 0.41,
          note: "Mega growth summit, huge speaker line-up!",
          summary: "We couldn't verify this invite with confidence. It might be spam or inaccurate — please proceed with caution.",
          event: { url: "https://bit.ly/demo-growth-summit", host: "bit.ly", title: "Mega Growth Summit 2026", description: "Shortened link — destination hidden.", startsAt: hoursFromNow(24 * 20), location: "Unknown" },
          findings: [
            { code: "url_shortener", severity: "warn", source: "rule", message: "The link uses a URL shortener, which hides the real destination." },
            { code: "weak_event_signals", severity: "warn", source: "page", message: "The page doesn't show a clear date, so it may not be a specific event." },
          ],
        },
      ];

      for (const d of demoInvites) {
        const sharerId = uid.get(d.by);
        if (!sharerId) continue;
        const [event] = await tx
          .insert(events)
          .values({ canonicalUrl: d.event.url, ...d.event })
          .onConflictDoNothing()
          .returning();
        if (!event) continue;
        const [invite] = await tx
          .insert(invites)
          .values({ eventId: event.id, sharedById: sharerId, note: d.note, status: "published", verdict: d.verdict, confidence: d.confidence, summary: d.summary })
          .returning();
        const groupRows = d.groups.map((s) => ({ inviteId: invite.id, groupId: gid.get(s)! })).filter((r) => r.groupId);
        if (groupRows.length) await tx.insert(inviteGroups).values(groupRows).onConflictDoNothing();
        await tx.insert(qcChecks).values({ inviteId: invite.id, verdict: d.verdict, confidence: d.confidence, provider: "demo-seed", findings: d.findings, pageFetched: false });
      }
    }

    // Idempotently seed sample notification preferences & inbox logs for @ada in demo mode
    const [ada] = await tx.select().from(users).where(eq(users.handle, "ada")).limit(1);
    if (!ada) return;
    const [existingPrefs] = await tx
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, ada.id))
      .limit(1);
    if (!existingPrefs) {
      await tx
        .insert(notificationPreferences)
        .values({
          userId: ada.id,
          timezone: "Europe/Amsterdam",
          quietStart: "22:00",
          quietEnd: "08:00",
          dailyCap: 5,
          digestMode: "daily",
          emailFallback: true,
        })
        .onConflictDoNothing();

      const emailDest = "ada@demo.invitz.app";
      const encEmail = encryptSecret(emailDest);
      const [emailCh] = await tx
        .insert(notificationChannels)
        .values({
          userId: ada.id,
          type: "email",
          destination: encEmail.ciphertext,
          destinationHash: hashDestination("email", emailDest),
          destinationKeyId: encEmail.keyId,
          verified: true,
          verifiedDryRun: true,
          enabled: true,
          digestMode: "daily",
        })
        .onConflictDoNothing()
        .returning();

      const sampleInvites = await tx
        .select({ id: invites.id, sharedById: invites.sharedById })
        .from(invites)
        .limit(4);
      const otherInvites = sampleInvites.filter((i) => i.sharedById !== ada.id);
      if (otherInvites.length > 0) {
        const now = new Date();
        await tx
          .insert(notifications)
          .values([
            {
              userId: ada.id,
              inviteId: otherInvites[0].id,
              channel: "in_app",
              reason: "You follow @maya",
              status: "sent",
              sentAt: now,
            },
            ...(otherInvites[1]
              ? [
                  {
                    userId: ada.id,
                    inviteId: otherInvites[1].id,
                    channel: "in_app" as const,
                    reason: "Shared in Everyone",
                    status: "sent" as const,
                    sentAt: new Date(now.getTime() - 3600_000),
                    readAt: new Date(now.getTime() - 1800_000),
                  },
                ]
              : []),
            ...(emailCh
              ? [
                  {
                    userId: ada.id,
                    inviteId: otherInvites[0].id,
                    channel: "email" as const,
                    channelId: emailCh.id,
                    reason: "Shared in Founders",
                    status: "queued" as const,
                    deliveryStatus: "scheduled",
                    scheduledFor: new Date(now.getTime() + 3600_000),
                  },
                ]
              : []),
          ])
          .onConflictDoNothing();
      }
    }
  });
}
