import { sql } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Invitz data model.
 *
 * Design notes (see docs/02-data-model.md):
 *  - Enumerations are plain `text` columns with TypeScript unions so new values
 *    (new channels, new group types, new verdicts) never need an ALTER TYPE migration.
 *  - An *event* is a unique link; an *invite* is one person sharing that event.
 *    Many invites can point at one event.
 *  - Every invite has >= 1 immutable qc_checks row (audit trail of why a verdict was given).
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });

export type Role = "user" | "moderator" | "admin";
export type GroupType = "general" | "topic" | "custom";
export type Visibility = "public" | "private";
export type Verdict = "verified" | "caution" | "rejected";
export type InviteStatus = "published" | "blocked" | "flagged";
export type ChannelType = "discord" | "whatsapp" | "signal" | "telegram" | "email";
export type NotificationChannel = "in_app" | ChannelType;
export type NotificationStatus = "pending" | "queued" | "sent" | "dry_run" | "failed" | "skipped" | "dead_letter";
export type DigestMode = "instant" | "hourly" | "daily" | "weekly";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    emailVerified: ts("email_verified"),
    name: text("name"),
    image: text("image"),
    handle: text("handle").notNull().unique(),
    handleUpdatedAt: ts("handle_updated_at"),
    displayName: text("display_name").notNull(),
    headline: text("headline").notNull().default(""),
    bio: text("bio").notNull().default(""),
    role: text("role").$type<Role>().notNull().default("user"),
    /** 0-100 reputation. Rises with verified shares, falls with blocked shares / reports. */
    trustScore: integer("trust_score").notNull().default(50),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_handle_lower_idx").on(sql`lower(${t.handle})`),
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("accounts_user_idx").on(t.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const authRateLimits = pgTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  resetAt: ts("reset_at").notNull(),
});

export const topics = pgTable("topics", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull().default("✨"),
});

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    type: text("type").$type<GroupType>().notNull(),
    visibility: text("visibility").$type<Visibility>().notNull().default("public"),
    topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("groups_type_idx").on(t.type)],
);

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "member">().notNull().default("member"),
    /** muted = still a member (can read the group) but gets no notifications. */
    muted: boolean("muted").notNull().default(false),
    joinedAt: ts("joined_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index("group_members_user_idx").on(t.userId)],
);

export const userInterests = pgTable(
  "user_interests",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.topicId] })],
);

export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The "bell": notify me whenever this person shares an invite. */
    notify: boolean("notify").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followeeId] }), index("follows_followee_idx").on(t.followeeId)],
);

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Normalised URL (tracking params stripped). Platform-agnostic: any https link is allowed. */
  canonicalUrl: text("canonical_url").notNull().unique(),
  url: text("url").notNull(),
  host: text("host").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url"),
  siteName: text("site_name"),
  startsAt: ts("starts_at"),
  location: text("location"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    sharedById: uuid("shared_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    note: text("note").notNull().default(""),
    status: text("status").$type<InviteStatus>().notNull().default("published"),
    verdict: text("verdict").$type<Verdict>().notNull(),
    confidence: real("confidence").notNull().default(0),
    summary: text("summary").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("invites_created_idx").on(t.createdAt),
    index("invites_status_created_idx").on(t.status, t.createdAt),
    index("invites_shared_by_idx").on(t.sharedById),
    index("invites_event_idx").on(t.eventId),
  ],
);

export const inviteGroups = pgTable(
  "invite_groups",
  {
    inviteId: uuid("invite_id")
      .notNull()
      .references(() => invites.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.inviteId, t.groupId] }), index("invite_groups_group_idx").on(t.groupId)],
);

export type QcFinding = {
  code: string;
  severity: "block" | "warn" | "info";
  message: string;
  source: "rule" | "page" | "ai";
};

export const qcChecks = pgTable(
  "qc_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inviteId: uuid("invite_id")
      .notNull()
      .references(() => invites.id, { onDelete: "cascade" }),
    verdict: text("verdict").$type<Verdict>().notNull(),
    confidence: real("confidence").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    findings: jsonb("findings").$type<QcFinding[]>().notNull().default([]),
    aiRaw: jsonb("ai_raw"),
    pageFetched: boolean("page_fetched").notNull().default(false),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("qc_checks_invite_idx").on(t.inviteId)],
);

/** The rulebook. Rules AND the AI prompt are generated from this table, so policy changes need no deploy. */
export const qcGuidelines = pgTable("qc_guidelines", {
  key: text("key").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  scope: text("scope").$type<"rule" | "ai">().notNull().default("rule"),
  severity: text("severity").$type<"block" | "warn" | "info">().notNull().default("warn"),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<ChannelType>().notNull(),
    /** AES-256-GCM encrypted destination (Discord webhook, E.164 phone, Telegram chat ID/handle, or email). */
    destination: text("destination").notNull(),
    /** Deterministic HMAC-SHA256 hash of normalized (type, destination) for O(1) uniqueness & webhook lookup. */
    destinationHash: text("destination_hash").notNull().default(""),
    destinationKeyId: text("destination_key_id").notNull().default("v1"),
    verified: boolean("verified").notNull().default(false),
    /** True if the code was verified in dry-run/unconfigured mode; prevents unconsented live sends. */
    verifiedDryRun: boolean("verified_dry_run").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    /** If false (default) only "verified" invites are pushed to this channel. */
    includeUnverified: boolean("include_unverified").notNull().default(false),
    digestMode: text("digest_mode").$type<DigestMode | null>(),
    /** Encrypted dry-run preview code (only populated when live provider is unconfigured). */
    verifyCode: text("verify_code"),
    /** HMAC-SHA256 hash of the 6-digit OTP code. */
    verifyCodeHash: text("verify_code_hash"),
    /** HMAC-SHA256 hash of the Telegram /start <token> deep-link token. */
    verifyTokenHash: text("verify_token_hash"),
    verifyExpiresAt: ts("verify_expires_at"),
    verifyAttempts: integer("verify_attempts").notNull().default(0),
    verifyLockedUntil: ts("verify_locked_until"),
    failureCount: integer("failure_count").notNull().default(0),
    disabledReason: text("disabled_reason"),
    optedInAt: ts("opted_in_at"),
    optInSource: text("opt_in_source"),
    optInConsentText: text("opt_in_consent_text"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("channels_unique_dest").on(t.userId, t.type, t.destinationHash),
    index("channels_type_hash_idx").on(t.type, t.destinationHash),
    index("channels_verify_token_hash_idx").on(t.verifyTokenHash),
  ],
);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  quietStart: text("quiet_start"),
  quietEnd: text("quiet_end"),
  dailyCap: integer("daily_cap").notNull().default(5),
  digestMode: text("digest_mode").$type<DigestMode>().notNull().default("instant"),
  emailFallback: boolean("email_fallback").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inviteId: uuid("invite_id")
      .notNull()
      .references(() => invites.id, { onDelete: "cascade" }),
    channel: text("channel").$type<NotificationChannel>().notNull(),
    channelId: uuid("channel_id").references(() => notificationChannels.id, { onDelete: "set null" }),
    reason: text("reason").notNull().default(""),
    status: text("status").$type<NotificationStatus>().notNull().default("pending"),
    deliveryStatus: text("delivery_status"),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    lastHttpStatus: integer("last_http_status"),
    error: text("error"),
    scheduledFor: ts("scheduled_for"),
    nextRetryAt: ts("next_retry_at"),
    deadLetteredAt: ts("dead_lettered_at"),
    digestSentAt: ts("digest_sent_at"),
    readAt: ts("read_at"),
    sentAt: ts("sent_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt),
    index("notifications_provider_msg_idx").on(t.providerMessageId),
    index("notifications_status_sched_idx").on(t.status, t.scheduledFor),
    uniqueIndex("notifications_in_app_uniq")
      .on(t.inviteId, t.userId)
      .where(sql`channel = 'in_app'`),
    uniqueIndex("notifications_ext_uniq")
      .on(t.inviteId, t.userId, t.channelId)
      .where(sql`channel_id is not null`),
    uniqueIndex("notifications_email_fallback_uniq")
      .on(t.inviteId, t.userId)
      .where(sql`channel = 'email' and channel_id is null`),
  ],
);

export const discordGuildSubscriptions = pgTable(
  "discord_guild_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    installedByUserId: uuid("installed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("discord_guild_sub_uniq").on(t.channelId, t.groupId),
    index("discord_guild_sub_group_idx").on(t.groupId),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inviteId: uuid("invite_id")
      .notNull()
      .references(() => invites.id, { onDelete: "cascade" }),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    details: text("details").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reports_unique").on(t.inviteId, t.reporterId)],
);
