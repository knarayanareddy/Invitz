import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDiscordContent, getAdapter, normalizePhone } from "@/lib/notify/adapters";

describe("notification adapters", () => {
  it("guards against prototype property lookups", () => {
    expect(getAdapter("toString")).toBeNull();
    expect(getAdapter("constructor")).toBeNull();
    expect(getAdapter("discord")?.type).toBe("discord");
  });

  it("validates discord webhooks including ptb/canary and thread_id", () => {
    const discord = getAdapter("discord")!;
    expect(discord.validate("https://discord.com/api/webhooks/123456/abc-def_123")).toBeNull();
    expect(discord.validate("https://ptb.discord.com/api/webhooks/123456/abc?thread_id=999")).toBeNull();
    expect(discord.validate("https://127.0.0.1/api/webhooks/123/abc")).not.toBeNull();
    expect(discord.validate("https://evil.com/discord.com/api/webhooks/123/abc")).not.toBeNull();
  });

  it("preserves Invitz URL in Discord content even when body text is long", () => {
    const content = formatDiscordContent({
      title: "✅ Test **Event**",
      text: "A".repeat(2500),
      url: "https://invitz.app/invites/550e8400-e29b-41d4-a716-446655440000",
    });
    expect(content.length).toBeLessThanOrEqual(1900);
    expect(content.endsWith("https://invitz.app/invites/550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(content).toContain("\\*\\*Event\\*\\*");
  });

  it("normalizes and validates E.164 phone numbers", () => {
    const whatsapp = getAdapter("whatsapp")!;
    expect(normalizePhone("+1 (415) 555-0123")).toBe("+14155550123");
    expect(whatsapp.validate("+1 415 555 0123")).toBeNull();
    expect(whatsapp.validate("00491511234567")).not.toBeNull();
  });
});

describe("fanOutInvite privacy & dry-run gating", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("never notifies non-member followers for private-group-only invites", async () => {
    const insertedPayloads: unknown[] = [];

    vi.doMock("@/db", () => {
      let selectIndex = 0;
      const results = [
        // 1. invite row
        [
          {
            id: "inv-1",
            status: "published",
            verdict: "verified",
            note: "Secret meetup",
            sharerId: "user-sharer",
            sharerHandle: "alice",
            title: "Stealth Founder Dinner",
            startsAt: null,
            location: "Berlin",
            eventUrl: "https://secret.example/dinner",
          },
        ],
        // 2. target groups (private ONLY)
        [{ id: "grp-priv", name: "Stealth Circle", visibility: "private" }],
        // 3. group members (only user-member, NOT user-stranger-follower)
        [{ userId: "user-member", groupId: "grp-priv", muted: false }],
        // 4. followers with notify=true (both member and stranger follow Alice)
        [{ id: "user-member" }, { id: "user-stranger-follower" }],
        // 5. notificationChannels
        [],
      ];

      const chain = () => {
        const res = results[selectIndex++] ?? [];
        const q = {
          from: () => q,
          innerJoin: () => q,
          where: () => q,
          limit: () => Promise.resolve(res),
          then: (resolve: (v: unknown) => void) => Promise.resolve(res).then(resolve),
        };
        return q;
      };

      return {
        db: {
          select: () => chain(),
          insert: () => ({
            values: (rows: unknown[]) => {
              insertedPayloads.push(...rows);
              return {
                onConflictDoNothing: () => ({
                  returning: () => Promise.resolve([]),
                }),
              };
            },
          }),
        },
      };
    });

    const { fanOutInvite } = await import("@/lib/notify/dispatch");
    await fanOutInvite("inv-1");

    expect(insertedPayloads).toHaveLength(1);
    expect((insertedPayloads[0] as { userId: string }).userId).toBe("user-member");
  });
});
