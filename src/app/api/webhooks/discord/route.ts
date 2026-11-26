import { createPublicKey, verify } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { discordGuildSubscriptions, groups } from "@/db/schema";

export const dynamic = "force-dynamic";

// RFC 8410 ASN.1 SubjectPublicKeyInfo prefix for raw 32-byte Ed25519 public keys
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function verifyDiscordSignature(rawBody: string, signatureHex: string | null, timestamp: string | null): boolean {
  const pubHex = process.env.DISCORD_PUBLIC_KEY?.trim();
  if (!pubHex || !signatureHex || !timestamp) return false;
  if (!/^[0-9a-fA-F]{64}$/.test(pubHex) || !/^[0-9a-fA-F]{128}$/.test(signatureHex)) {
    return false;
  }
  try {
    const spki = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pubHex, "hex")]);
    const keyObj = createPublicKey({ key: spki, format: "der", type: "spki" });
    return verify(null, Buffer.from(timestamp + rawBody, "utf8"), keyObj, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

type DiscordInteraction = {
  type?: number;
  guild_id?: string;
  channel_id?: string;
  member?: { permissions?: string };
  data?: {
    name?: string;
    options?: Array<{
      name?: string;
      type?: number;
      options?: Array<{ name?: string; value?: string }>;
    }>;
  };
};

function hasManageGuildPermission(permissionsStr?: string): boolean {
  if (!permissionsStr) return false;
  try {
    const perms = BigInt(permissionsStr);
    const ADMINISTRATOR = BigInt(0x8);
    const MANAGE_GUILD = BigInt(0x20);
    return (perms & ADMINISTRATOR) !== BigInt(0) || (perms & MANAGE_GUILD) !== BigInt(0);
  } catch {
    return false;
  }
}

function reply(content: string, ephemeral = true) {
  return Response.json({
    type: 4,
    data: {
      content,
      flags: ephemeral ? 64 : 0,
      allowed_mentions: { parse: [] },
    },
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const sig = request.headers.get("x-signature-ed25519");
  const ts = request.headers.get("x-signature-timestamp");

  if (!verifyDiscordSignature(rawBody, sig, ts)) {
    return Response.json({ error: "Invalid request signature" }, { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return Response.json({ error: "Malformed JSON" }, { status: 400 });
  }

  // Discord PING verification
  if (interaction.type === 1) {
    return Response.json({ type: 1 });
  }

  if (interaction.type === 2 && interaction.data?.name === "invitz") {
    const guildId = interaction.guild_id;
    const channelId = interaction.channel_id;
    if (!guildId || !channelId) {
      return reply("Use `/invitz` inside a Discord server channel.");
    }

    const sub = interaction.data.options?.[0];
    const subName = sub?.name;
    const slug = sub?.options?.find((o) => o.name === "community")?.value?.trim().toLowerCase();

    if (subName === "list") {
      const subs = await db
        .select({ slug: groups.slug, name: groups.name })
        .from(discordGuildSubscriptions)
        .innerJoin(groups, eq(groups.id, discordGuildSubscriptions.groupId))
        .where(eq(discordGuildSubscriptions.channelId, channelId));
      if (subs.length === 0) {
        return reply("This Discord channel isn't subscribed to any Invitz communities yet.");
      }
      return reply(
        `Subscribed Invitz communities in this channel:\n${subs.map((s) => `• **${s.name}** (\`${s.slug}\`)`).join("\n")}`,
      );
    }

    if (!hasManageGuildPermission(interaction.member?.permissions)) {
      return reply("You need **Manage Server** permission to subscribe or unsubscribe this channel.");
    }

    if (!slug) {
      return reply("Please specify a community slug, e.g. `/invitz subscribe community:ml-engineers`.");
    }

    // Security invariant: Discord server bots can ONLY subscribe to public Invitz communities.
    const [group] = await db
      .select()
      .from(groups)
      .where(and(eq(groups.slug, slug), eq(groups.visibility, "public")))
      .limit(1);

    if (!group) {
      return reply(`No public Invitz community found with slug \`${slug}\`.`);
    }

    if (subName === "subscribe") {
      await db
        .insert(discordGuildSubscriptions)
        .values({ guildId, channelId, groupId: group.id })
        .onConflictDoNothing();
      return reply(`✅ Subscribed this channel to **${group.name}** (\`${group.slug}\`) verified invites!`, false);
    }

    if (subName === "unsubscribe") {
      await db
        .delete(discordGuildSubscriptions)
        .where(and(eq(discordGuildSubscriptions.channelId, channelId), eq(discordGuildSubscriptions.groupId, group.id)));
      return reply(`Unsubscribed this channel from **${group.name}** (\`${group.slug}\`).`, false);
    }

    return reply("Supported commands: `/invitz subscribe`, `/invitz unsubscribe`, `/invitz list`.");
  }

  return reply("Unsupported interaction.");
}
