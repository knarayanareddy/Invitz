import dns from "node:dns/promises";
import net from "node:net";

export type StructuredEvent = {
  name?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  online?: boolean;
};

export type PageMeta = {
  finalUrl: string;
  status: number;
  title: string;
  description: string;
  imageUrl: string | null;
  siteName: string | null;
  text: string;
  event: StructuredEvent | null;
};

const MAX_BYTES = 512 * 1024;
const MAX_HOPS = 3;

function isPrivateIPv4Bytes(a: number, b: number, c: number, _d: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function parseIPv6Hextets(ip: string): number[] | null {
  if (ip.includes("%")) return null;
  let normalized = ip.toLowerCase();
  const lastColon = normalized.lastIndexOf(":");
  if (lastColon !== -1 && normalized.slice(lastColon + 1).includes(".")) {
    const v4Part = normalized.slice(lastColon + 1);
    if (net.isIP(v4Part) !== 4) return null;
    const [a, b, c, d] = v4Part.split(".").map(Number);
    const h1 = ((a << 8) | b).toString(16);
    const h2 = ((c << 8) | d).toString(16);
    normalized = `${normalized.slice(0, lastColon)}:${h1}:${h2}`;
  }

  const dblParts = normalized.split("::");
  if (dblParts.length > 2) return null;

  const parseGroup = (part: string) =>
    part === "" ? [] : part.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));

  const left = parseGroup(dblParts[0]);
  const right = dblParts.length === 2 ? parseGroup(dblParts[1]) : [];
  if (left.some(Number.isNaN) || right.some(Number.isNaN)) return null;

  if (dblParts.length === 1) {
    return left.length === 8 ? left : null;
  }
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

function embeddedIPv4IsPrivate(h1: number, h2: number): boolean {
  return isPrivateIPv4Bytes((h1 >> 8) & 0xff, h1 & 0xff, (h2 >> 8) & 0xff, h2 & 0xff);
}

export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const parts = ip.split(".").map(Number);
    return parts.length !== 4 || isPrivateIPv4Bytes(parts[0], parts[1], parts[2], parts[3]);
  }
  if (v === 6) {
    const h = parseIPv6Hextets(ip);
    if (!h) return true; // fail closed

    // :: and ::1
    const allZeroPrefix = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;
    if (allZeroPrefix && h[5] === 0) {
      if (h[6] === 0 && (h[7] === 0 || h[7] === 1)) return true;
      // IPv4-compatible IPv6 ::/96
      return embeddedIPv4IsPrivate(h[6], h[7]);
    }
    // IPv4-mapped IPv6 ::ffff:0:0/96
    if (allZeroPrefix && h[5] === 0xffff) {
      return embeddedIPv4IsPrivate(h[6], h[7]);
    }
    // IPv4-translated ::ffff:0:0:0/96
    if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0xffff && h[5] === 0) {
      return embeddedIPv4IsPrivate(h[6], h[7]);
    }
    // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
    if (h[0] === 0x0064 && h[1] === 0xff9b) {
      if (h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
        return embeddedIPv4IsPrivate(h[6], h[7]);
      }
      if (h[2] === 1) return true;
    }
    // Discard 100::/64
    if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true;
    // Special-purpose 2001::/32 (Teredo), 2001:2::/48, 2001:20::/28, 2001:db8::/32
    if (h[0] === 0x2001 && (h[1] === 0 || (h[1] === 2 && h[2] === 0) || (h[1] & 0xfff0) === 0x0020 || h[1] === 0x0db8)) {
      return true;
    }
    // 6to4 2002::/16 — inspect embedded IPv4 relay
    if (h[0] === 0x2002) {
      return embeddedIPv4IsPrivate(h[1], h[2]);
    }
    // ULA fc00::/7, link-local fe80::/10, deprecated site-local fec0::/10, multicast ff00::/8
    if ((h[0] & 0xfe00) === 0xfc00) return true;
    if ((h[0] & 0xffc0) === 0xfe80) return true;
    if ((h[0] & 0xffc0) === 0xfec0) return true;
    if ((h[0] & 0xff00) === 0xff00) return true;
    return false;
  }
  return true; // unknown format: fail closed
}

export type FetchPageDeps = {
  lookup?: (hostname: string) => Promise<{ address: string }[]>;
  fetchImpl?: typeof fetch;
};

async function assertPublicHost(hostname: string, lookupFn?: FetchPageDeps["lookup"]) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("private address");
    return;
  }
  const records = lookupFn ? await lookupFn(host) : await dns.lookup(host, { all: true });
  if (records.length === 0 || records.some((r) => isPrivateAddress(r.address))) {
    throw new Error("host resolves to a private address");
  }
}

async function readLimited(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
  }
  reader.cancel().catch(() => undefined);
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function parseAttrs(s: string) {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
  }
  return out;
}

function metaMap(html: string) {
  const map = new Map<string, string>();
  for (const m of html.matchAll(/<meta\s+([^>]+?)\/?>/gi)) {
    const a = parseAttrs(m[1]);
    const key = (a.property ?? a.name ?? "").toLowerCase();
    if (key && a.content && !map.has(key)) map.set(key, decodeEntities(a.content));
  }
  return map;
}

function placeToString(loc: unknown): { text?: string; online?: boolean } {
  if (!loc) return {};
  if (typeof loc === "string") return { text: loc };
  if (Array.isArray(loc)) return placeToString(loc[0]);
  if (typeof loc === "object") {
    const o = loc as Record<string, unknown>;
    if (String(o["@type"] ?? "").includes("VirtualLocation")) return { text: "Online", online: true };
    const addr = o.address;
    let addrText = "";
    if (typeof addr === "string") addrText = addr;
    else if (addr && typeof addr === "object") {
      const a = addr as Record<string, unknown>;
      addrText = [a.streetAddress, a.addressLocality, a.addressCountry].filter((x) => typeof x === "string").join(", ");
    }
    const text = [o.name, addrText].filter((x) => typeof x === "string" && x).join(" — ");
    return { text: text || undefined };
  }
  return {};
}

function findEvent(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findEvent(n);
      if (f) return f;
    }
    return null;
  }
  const o = node as Record<string, unknown>;
  const types = ([] as unknown[]).concat(o["@type"] ?? []).map(String);
  if (types.some((t) => t.endsWith("Event"))) return o;
  if (o["@graph"]) return findEvent(o["@graph"]);
  return null;
}

export function parseStructuredEvent(html: string): StructuredEvent | null {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const ev = findEvent(JSON.parse(m[1]));
      if (ev) {
        const place = placeToString(ev.location);
        const str = (v: unknown) => (typeof v === "string" ? decodeEntities(v) : undefined);
        return {
          name: str(ev.name),
          startDate: str(ev.startDate),
          endDate: str(ev.endDate),
          location: place.text ? decodeEntities(place.text) : undefined,
          online: place.online || String(ev.eventAttendanceMode ?? "").includes("Online"),
        };
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return null;
}

export function visibleText(html: string) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  ).slice(0, 6000);
}

function safeImageUrl(raw: string | undefined, baseUrl: URL): string | null {
  if (!raw) return null;
  try {
    const resolved = new URL(raw, baseUrl);
    if (resolved.protocol !== "https:") return null;
    if (resolved.username || resolved.password) return null;
    return resolved.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

/**
 * Fetches a user-supplied URL safely (SSRF-hardened) and extracts event metadata.
 * Throws on any network / policy failure; the caller turns that into a QC warning.
 *
 * Known limitation: DNS-rebinding between lookup and connect. In production route this
 * through an egress proxy that blocks private ranges (see docs/phases/phase-6).
 */
export async function fetchPage(rawUrl: string, deps?: FetchPageDeps): Promise<PageMeta> {
  const fetchFn = deps?.fetchImpl ?? fetch;
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const u = new URL(current);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("unsupported protocol");
    if (u.port && u.port !== "80" && u.port !== "443") throw new Error("unsupported port");
    if (u.username || u.password) throw new Error("credentials not allowed in URL");
    await assertPublicHost(u.hostname, deps?.lookup);

    const res = await fetchFn(u, {
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
      headers: {
        "user-agent": "InvitzBot/0.1 (event link verification)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      current = new URL(location, u).toString();
      continue;
    }
    if (res.status >= 400) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`page responded with HTTP ${res.status}`);
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`unsupported content type (${type || "unknown"})`);
    }

    const html = await readLimited(res);
    const meta = metaMap(html);
    const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    return {
      finalUrl: current,
      status: res.status,
      title: (meta.get("og:title") ?? (titleTag ? decodeEntities(titleTag.trim()) : "")).slice(0, 200),
      description: (meta.get("og:description") ?? meta.get("description") ?? "").slice(0, 600),
      imageUrl: safeImageUrl(meta.get("og:image"), u),
      siteName: meta.get("og:site_name") ?? null,
      text: visibleText(html),
      event: parseStructuredEvent(html),
    };
  }
  throw new Error("too many redirects");
}
