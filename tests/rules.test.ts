import { afterEach, describe, expect, it } from "vitest";
import { inspectText, inspectUrl } from "@/lib/qc/rules";

describe("inspectUrl", () => {
  const prevBlocked = process.env.INVITZ_BLOCKED_DOMAINS;

  afterEach(() => {
    if (prevBlocked === undefined) {
      delete process.env.INVITZ_BLOCKED_DOMAINS;
    } else {
      process.env.INVITZ_BLOCKED_DOMAINS = prevBlocked;
    }
  });

  it("passes clean https domain", () => {
    expect(inspectUrl(new URL("https://lu.ma/ai-conf-2026"))).toEqual([]);
  });

  it("flags non-https, raw IPs, blocklist, shorteners, and suspicious TLDs/punycode", () => {
    expect(inspectUrl(new URL("http://example.com/ev")).map((i) => i.code)).toContain("https_only");
    expect(inspectUrl(new URL("https://1.2.3.4/ev")).map((i) => i.code)).toContain("ip_host");
    expect(inspectUrl(new URL("https://[::1]/ev")).map((i) => i.code)).toContain("ip_host");
    expect(inspectUrl(new URL("https://bit.ly/abc")).map((i) => i.code)).toContain("url_shortener");
    expect(inspectUrl(new URL("https://xn--pple-43d.com/ev")).map((i) => i.code)).toContain("suspicious_domain");
    expect(inspectUrl(new URL("https://evil.zip/ev")).map((i) => i.code)).toContain("suspicious_domain");

    process.env.INVITZ_BLOCKED_DOMAINS = "spam.example, bad.org";
    expect(inspectUrl(new URL("https://sub.spam.example/x")).map((i) => i.code)).toContain("blocklisted_domain");
    expect(inspectUrl(new URL("https://notspam.example/x"))).toEqual([]);
  });
});

describe("inspectText", () => {
  it("passes normal event descriptions", () => {
    expect(inspectText("Three talks on production ML in Berlin on Dec 5.")).toEqual([]);
  });

  it("detects scam language and promo language", () => {
    expect(inspectText("Send 1 BTC for guaranteed profits").map((i) => i.code)).toContain("scam_language");
    expect(inspectText("Enter your seed phrase to claim tickets").map((i) => i.code)).toContain("scam_language");
    expect(inspectText("Click here to earn $5000 fast!!!!").map((i) => i.code)).toContain("promo_language");
    expect(inspectText("JOIN THIS AMAZING EVENT RIGHT NOW IN LONDON!!!").map((i) => i.code)).toContain("promo_language");
  });
});
