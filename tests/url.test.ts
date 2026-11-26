import { describe, expect, it } from "vitest";
import { canonicalizeUrl, hostOf, isUuid, parseUserUrl } from "@/lib/url";

describe("parseUserUrl", () => {
  it("adds https when scheme is missing and preserves valid URLs", () => {
    const res = parseUserUrl("lu.ma/ai-meetup");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.url.toString()).toBe("https://lu.ma/ai-meetup");
    }
  });

  it("rejects empty, overly long, credential-bearing, or non-http(s) URLs", () => {
    expect(parseUserUrl("   ").ok).toBe(false);
    expect(parseUserUrl(`https://example.com/${"a".repeat(2050)}`).ok).toBe(false);
    expect(parseUserUrl("https://user:pass@example.com/ev").ok).toBe(false);
    expect(parseUserUrl("https://user@example.com/ev").ok).toBe(false);
    expect(parseUserUrl("javascript:alert(1)").ok).toBe(false);
    expect(parseUserUrl("ftp://example.com/file").ok).toBe(false);
    expect(parseUserUrl("https://localhost/test").ok).toBe(false);
  });
});

describe("canonicalizeUrl", () => {
  it("normalizes www, trailing slash with query params, hash, and tracking parameters", () => {
    const a = new URL("https://www.lu.ma/mlops-berlin/?utm_source=x&b=2&a=1#details");
    const b = new URL("https://lu.ma/mlops-berlin?a=1&b=2&fbclid=123&aff=partner");
    expect(canonicalizeUrl(a)).toBe("https://lu.ma/mlops-berlin?a=1&b=2");
    expect(canonicalizeUrl(b)).toBe("https://lu.ma/mlops-berlin?a=1&b=2");
  });

  it("keeps root path slash intact", () => {
    expect(canonicalizeUrl(new URL("https://Example.COM"))).toBe("https://example.com/");
  });
});

describe("hostOf & isUuid", () => {
  it("strips www prefix in hostOf", () => {
    expect(hostOf("https://www.eventbrite.com/e/123")).toBe("eventbrite.com");
  });

  it("validates UUIDs strictly", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
