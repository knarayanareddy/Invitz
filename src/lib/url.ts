const TRACKING_PARAMS =
  /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|_hsenc|_hsmi|aff|eventOrigin|trk|si)$/i;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Ensures post-login redirect targets are strict relative paths (prevents open redirects). */
export function sanitizeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "/";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return "/";
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return "/";
  try {
    const parsed = new URL(trimmed, "https://invitz.local");
    if (parsed.origin !== "https://invitz.local") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export type ParsedUrl = { ok: true; url: URL } | { ok: false; error: string };

/** Accepts anything a human might paste: adds https:// when the scheme is missing. */
export function parseUserUrl(input: string): ParsedUrl {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Paste a link to the event." };
  if (raw.length > 2048) return { ok: false, error: "That link is too long." };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: "That doesn't look like a valid link." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Only http(s) links can be shared." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Links containing credentials are not allowed." };
  }
  if (!url.hostname.includes(".") && !/^\[.*\]$/.test(url.hostname)) {
    return { ok: false, error: "That link has no valid domain." };
  }
  return { ok: true, url };
}

/** Normalises a URL so the same event shared twice maps to one `events` row. */
export function canonicalizeUrl(input: URL): string {
  const u = new URL(input.toString());
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  if (u.pathname !== "/") {
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  }
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  return u.toString();
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
