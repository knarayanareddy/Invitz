import net from "node:net";

/**
 * Deterministic QC rules. Each issue's `code` MUST match a row in `qc_guidelines`;
 * the pipeline looks up severity / enabled state there, so policy is data, not code.
 */
export type Issue = { code: string; message: string };

const SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly",
  "cutt.ly", "shorturl.at", "lnkd.in", "tiny.cc", "rb.gy", "t.ly",
]);

const SUSPICIOUS_TLDS = new Set(["zip", "mov", "click", "country", "gq", "tk", "ml", "cf", "ga", "work", "support"]);

function blocklist(): string[] {
  return (process.env.INVITZ_BLOCKED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function inspectUrl(url: URL): Issue[] {
  const issues: Issue[] = [];
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (url.protocol !== "https:") {
    issues.push({ code: "https_only", message: "The link is not served over HTTPS." });
  }
  if (net.isIP(host)) {
    issues.push({ code: "ip_host", message: "The link points at a raw IP address instead of a domain." });
  }
  if (blocklist().some((d) => hostMatches(host, d))) {
    issues.push({ code: "blocklisted_domain", message: `The domain ${host} is on the Invitz blocklist.` });
  }
  if ([...SHORTENERS].some((d) => hostMatches(host, d))) {
    issues.push({
      code: "url_shortener",
      message: "The link uses a URL shortener, which hides the real destination.",
    });
  }
  const tld = host.split(".").pop() ?? "";
  if (host.includes("xn--") || SUSPICIOUS_TLDS.has(tld)) {
    issues.push({
      code: "suspicious_domain",
      message: "The domain looks unusual (look-alike characters or a high-abuse TLD).",
    });
  }
  return issues;
}

const SCAM_PATTERNS: RegExp[] = [
  /seed\s*phrase|private\s*key|recovery\s*phrase/i,
  /double\s+your\s+(money|crypto|btc|eth|investment)/i,
  /guaranteed\s+(returns?|profits?|income)/i,
  /(send|transfer|deposit)\s+(\d+\s*)?(btc|eth|usdt|bitcoin|ethereum)/i,
  /wire\s+transfer|western\s+union|gift\s*cards?\b/i,
  /\b(onlyfans|escort|casino|sports\s*betting)\b/i,
  /100%\s*(free\s*money|profit|risk[-\s]*free)/i,
];

const PROMO_PATTERNS: RegExp[] = [
  /\bclick\s+here\b/i,
  /\bdm\s+me\b/i,
  /\bearn\s+\$?\d+/i,
  /!{4,}/,
  /\b(make|making)\s+money\s+(fast|online)\b/i,
  /\bjoin\s+my\s+(telegram|whatsapp)\b/i,
];

export function inspectText(text: string): Issue[] {
  const issues: Issue[] = [];
  if (!text.trim()) return issues;
  if (SCAM_PATTERNS.some((p) => p.test(text))) {
    issues.push({
      code: "scam_language",
      message: "The text contains language typical of scams (financial promises, wallet/credential requests, or banned content).",
    });
  }
  const letters = text.replace(/[^a-zA-Z]/g, "");
  const upper = text.replace(/[^A-Z]/g, "");
  const shouty = letters.length > 25 && upper.length / letters.length > 0.6;
  if (shouty || PROMO_PATTERNS.some((p) => p.test(text))) {
    issues.push({
      code: "promo_language",
      message: "The text reads like aggressive promotion (all-caps, excessive punctuation, or 'click here' style calls).",
    });
  }
  return issues;
}
