CREATE TABLE "discord_guild_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"group_id" uuid NOT NULL,
	"installed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"quiet_start" text,
	"quiet_end" text,
	"daily_cap" integer DEFAULT 5 NOT NULL,
	"digest_mode" text DEFAULT 'instant' NOT NULL,
	"email_fallback" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "channels_unique_dest";--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "destination_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "destination_key_id" text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "digest_mode" text;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "verify_code_hash" text;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "verify_token_hash" text;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "opted_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "opt_in_source" text;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "opt_in_consent_text" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "delivery_status" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "last_http_status" integer;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "digest_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discord_guild_subscriptions" ADD CONSTRAINT "discord_guild_subscriptions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_guild_subscriptions" ADD CONSTRAINT "discord_guild_subscriptions_installed_by_user_id_users_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discord_guild_sub_uniq" ON "discord_guild_subscriptions" USING btree ("channel_id","group_id");--> statement-breakpoint
CREATE INDEX "discord_guild_sub_group_idx" ON "discord_guild_subscriptions" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "channels_type_hash_idx" ON "notification_channels" USING btree ("type","destination_hash");--> statement-breakpoint
CREATE INDEX "channels_verify_token_hash_idx" ON "notification_channels" USING btree ("verify_token_hash");--> statement-breakpoint
CREATE INDEX "notifications_provider_msg_idx" ON "notifications" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "notifications_status_sched_idx" ON "notifications" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_email_fallback_uniq" ON "notifications" USING btree ("invite_id","user_id") WHERE channel = 'email' and channel_id is null;--> statement-breakpoint
UPDATE "notification_channels" SET "destination_hash" = 'legacy:' || "id"::text WHERE "destination_hash" = '';--> statement-breakpoint
CREATE UNIQUE INDEX "channels_unique_dest" ON "notification_channels" USING btree ("user_id","type","destination_hash");