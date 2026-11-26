import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { ChannelType } from "@/db/schema";

const ENC_PREFIX = "enc:v1:";

type KeyRing = {
  activeKeyId: string;
  keys: Map<string, Buffer>;
  lookupKey: Buffer;
};

function parseKeyMaterial(raw: string, keyId: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const b64 = Buffer.from(trimmed, "base64");
  if (b64.length === 32) {
    return b64;
  }
  return Buffer.from(hkdfSync("sha256", Buffer.from(trimmed, "utf8"), Buffer.from("invitz-kms-salt"), Buffer.from(`invitz-enc-${keyId}`), 32));
}

function getKeyRing(): KeyRing {
  const keys = new Map<string, Buffer>();
  const activeKeyId = (process.env.NOTIFICATION_ACTIVE_KEY_ID ?? "v1").trim() || "v1";

  const multiJson = process.env.NOTIFICATION_ENCRYPTION_KEYS;
  if (multiJson) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(multiJson) as Record<string, unknown>;
    } catch {
      throw new Error("NOTIFICATION_ENCRYPTION_KEYS must be valid JSON");
    }
    for (const [id, val] of Object.entries(parsed)) {
      if (typeof val === "string" && val.trim()) {
        keys.set(id, parseKeyMaterial(val, id));
      }
    }
  }

  const singleKey = process.env.NOTIFICATION_ENCRYPTION_KEY ?? process.env.KMS_DATA_KEY;
  if (singleKey && singleKey.trim() && !keys.has(activeKeyId)) {
    keys.set(activeKeyId, parseKeyMaterial(singleKey, activeKeyId));
  }

  if (keys.size === 0) {
    const fallbackSecret = process.env.AUTH_SECRET;
    if (fallbackSecret && fallbackSecret.trim()) {
      keys.set(activeKeyId, parseKeyMaterial(fallbackSecret, activeKeyId));
    } else if (process.env.NODE_ENV === "production") {
      throw new Error("NOTIFICATION_ENCRYPTION_KEY or AUTH_SECRET is required in production");
    } else {
      // Development-only deterministic key so local dev/tests work without config.
      keys.set(activeKeyId, parseKeyMaterial("invitz-dev-only-key-do-not-use-in-prod", activeKeyId));
    }
  }

  const activeKey = keys.get(activeKeyId) ?? keys.values().next().value;
  if (!activeKey) {
    throw new Error("No encryption key available");
  }

  const lookupSource = process.env.NOTIFICATION_LOOKUP_SECRET ?? process.env.AUTH_SECRET ?? activeKey.toString("hex");
  const lookupKey = Buffer.from(
    hkdfSync("sha256", Buffer.from(lookupSource, "utf8"), Buffer.from("invitz-hmac-salt"), Buffer.from("invitz-lookup-v1"), 32),
  );

  return { activeKeyId: keys.has(activeKeyId) ? activeKeyId : keys.keys().next().value!, keys, lookupKey };
}

export function encryptSecret(plaintext: string): { ciphertext: string; keyId: string } {
  const { activeKeyId, keys } = getKeyRing();
  const key = keys.get(activeKeyId);
  if (!key) throw new Error(`Active encryption key '${activeKeyId}' not found`);

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    keyId: activeKeyId,
    ciphertext: `${ENC_PREFIX}${activeKeyId}:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`,
  };
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) {
    return stored;
  }
  const rest = stored.slice(ENC_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 4) {
    throw new Error("Malformed encrypted destination payload");
  }
  const [keyId, ivB64, tagB64, ctB64] = parts;
  const { keys } = getKeyRing();
  const key = keys.get(keyId);
  if (!key) {
    throw new Error(`Unknown encryption key id '${keyId}'`);
  }

  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ct = Buffer.from(ctB64, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function normalizeDestinationForHash(type: ChannelType, raw: string): string {
  const trimmed = raw.trim();
  if (type === "whatsapp" || type === "signal") {
    return trimmed.replace(/[\s()-]/g, "");
  }
  if (type === "email") {
    return trimmed.toLowerCase();
  }
  if (type === "telegram") {
    return trimmed.startsWith("@") ? trimmed.toLowerCase() : trimmed;
  }
  return trimmed;
}

export function hashDestination(type: ChannelType, destination: string): string {
  const { lookupKey } = getKeyRing();
  const normalized = normalizeDestinationForHash(type, destination);
  return createHmac("sha256", lookupKey).update(`${type}:${normalized}`).digest("hex");
}

export function hashVerifySecret(secret: string): string {
  const { lookupKey } = getKeyRing();
  return createHmac("sha256", lookupKey).update(`verify:${secret.trim()}`).digest("hex");
}

export function verifySecretConstantTime(candidate: string, expectedHash: string | null | undefined): boolean {
  if (!expectedHash) return false;
  const candidateHash = hashVerifySecret(candidate);
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export function signUnsubscribeToken(channelId: string): string {
  const { lookupKey } = getKeyRing();
  const sig = createHmac("sha256", lookupKey).update(`unsub:${channelId}`).digest("base64url");
  return `${channelId}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const channelId = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  if (!channelId || !providedSig) return null;
  const { lookupKey } = getKeyRing();
  const expectedSig = createHmac("sha256", lookupKey).update(`unsub:${channelId}`).digest("base64url");
  const a = Buffer.from(providedSig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? channelId : null;
}

export function maskDestination(type: ChannelType, plaintext: string): string {
  if (type === "discord") {
    const match = plaintext.match(/^(https:\/\/[^/]+\/api\/webhooks\/\d+)\/([\w.-]+)(.*)$/);
    if (match) {
      const tokenTail = match[2].slice(-4);
      return `${match[1]}/••••${tokenTail}${match[3]}`;
    }
    return `${plaintext.slice(0, 38)}…`;
  }
  if (type === "whatsapp" || type === "signal") {
    if (plaintext.length > 6) {
      return `${plaintext.slice(0, 4)}••••${plaintext.slice(-3)}`;
    }
    return plaintext;
  }
  if (type === "email") {
    const [local, domain] = plaintext.split("@");
    if (!domain) return plaintext;
    const prefix = local.slice(0, Math.min(2, local.length));
    return `${prefix}***@${domain}`;
  }
  if (type === "telegram") {
    if (plaintext.startsWith("@")) return plaintext;
    if (plaintext.startsWith("pending:")) return "Awaiting Telegram /start confirmation";
    if (plaintext.length > 4) return `chat ••••${plaintext.slice(-4)}`;
    return `chat ${plaintext}`;
  }
  return plaintext;
}
