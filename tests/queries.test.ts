import { describe, expect, it } from "vitest";
import { filterVisibleTargetGroups } from "@/lib/queries";
import { sanitizeNextPath } from "@/lib/url";

describe("filterVisibleTargetGroups", () => {
  const targets = [
    { inviteId: "i1", id: "g-pub", slug: "founders", name: "Founders", type: "topic", visibility: "public" },
    { inviteId: "i1", id: "g-priv", slug: "secret-abc", name: "Secret Crew", type: "custom", visibility: "private" },
  ];

  it("hides private non-member group chips from anonymous and non-member viewers", () => {
    const owners = new Map([["i1", "user-alice"]]);
    expect(filterVisibleTargetGroups(targets, new Set(), owners, null).map((g) => g.id)).toEqual(["g-pub"]);
    expect(filterVisibleTargetGroups(targets, new Set(), owners, "user-bob").map((g) => g.id)).toEqual(["g-pub"]);
  });

  it("reveals private group chips to group members and to the invite owner", () => {
    const owners = new Map([["i1", "user-alice"]]);
    expect(filterVisibleTargetGroups(targets, new Set(["g-priv"]), owners, "user-bob").map((g) => g.id)).toEqual([
      "g-pub",
      "g-priv",
    ]);
    expect(filterVisibleTargetGroups(targets, new Set(), owners, "user-alice").map((g) => g.id)).toEqual([
      "g-pub",
      "g-priv",
    ]);
  });
});

describe("sanitizeNextPath", () => {
  it("preserves safe relative paths with query strings", () => {
    expect(sanitizeNextPath("/share?group=founders")).toBe("/share?group=founders");
    expect(sanitizeNextPath("/settings")).toBe("/settings");
    expect(sanitizeNextPath("/onboarding")).toBe("/onboarding");
  });

  it("rejects protocol-relative, absolute, backslash, or control-char redirects", () => {
    expect(sanitizeNextPath("https://evil.example/phish")).toBe("/");
    expect(sanitizeNextPath("//evil.example/phish")).toBe("/");
    expect(sanitizeNextPath("/\\evil.example")).toBe("/");
    expect(sanitizeNextPath("javascript:alert(1)")).toBe("/");
    expect(sanitizeNextPath("/ok\r\nSet-Cookie: a=1")).toBe("/");
    expect(sanitizeNextPath(undefined)).toBe("/");
  });
});
