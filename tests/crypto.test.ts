import { afterEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hashDestination,
  hashVerifySecret,
  maskDestination,
  signUnsubscribeToken,
  verifySecretConstantTime,
  verifyUnsubscribeToken,
} from "@/lib/crypto";

describe("notification envelope crypto & HMAC helpers", () => {
  const prevKeys = process.env.NOTIFICATION_ENCRYPTION_KEYS;
  const prevActive = process.env.NOTIFICATION_ACTIVE_KEY_ID;
  const prevSingle = process.env.NOTIFICATION_ENCRYPTION_KEY;

  afterEach(() => {
    if (prevKeys === undefined) delete process.env.NOTIFICATION_ENCRYPTION_KEYS;
    else process.env.NOTIFICATION_ENCRYPTION_KEYS = prevKeys;
    if (prevActive === undefined) delete process.env.NOTIFICATION_ACTIVE_KEY_ID;
    else process.env.NOTIFICATION_ACTIVE_KEY_ID = prevActive;
    if (prevSingle === undefined) delete process.env.NOTIFICATION_ENCRYPTION_KEY;
    else process.env.NOTIFICATION_ENCRYPTION_KEY = prevSingle;
  });

  it("encrypts and decrypts secrets and detects tampering", () => {
    const { ciphertext, keyId } = encryptSecret("https://discord.com/api/webhooks/123456/secret-token");
    expect(ciphertext.startsWith(`enc:v1:${keyId}:`)).toBe(true);
    expect(ciphertext).not.toContain("secret-token");
    expect(decryptSecret(ciphertext)).toBe("https://discord.com/api/webhooks/123456/secret-token");

    // Flip a byte inside the encrypted payload/tag to verify GCM auth tag failure
    const parts = ciphertext.split(":");
    const ctSeg = parts[5]!;
    parts[5] = `${ctSeg.startsWith("A") ? "B" : "A"}${ctSeg.slice(1)}`;
    const tampered = parts.join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("supports multi-key rotation while decrypting older key versions", () => {
    process.env.NOTIFICATION_ENCRYPTION_KEYS = JSON.stringify({
      v1: "a".repeat(64),
      v2: "b".repeat(64),
    });
    process.env.NOTIFICATION_ACTIVE_KEY_ID = "v1";
    const oldCipher = encryptSecret("+14155550123");
    expect(oldCipher.keyId).toBe("v1");

    process.env.NOTIFICATION_ACTIVE_KEY_ID = "v2";
    const newCipher = encryptSecret("+14155550124");
    expect(newCipher.keyId).toBe("v2");

    expect(decryptSecret(oldCipher.ciphertext)).toBe("+14155550123");
    expect(decryptSecret(newCipher.ciphertext)).toBe("+14155550124");
  });

  it("computes normalized deterministic destination lookup hashes", () => {
    expect(hashDestination("whatsapp", "+1 (415) 555-0123")).toBe(hashDestination("whatsapp", "+14155550123"));
    expect(hashDestination("email", "Ada@Example.COM ")).toBe(hashDestination("email", "ada@example.com"));
    expect(hashDestination("whatsapp", "+14155550123")).not.toBe(hashDestination("signal", "+14155550123"));
  });

  it("verifies OTP codes and signed unsubscribe tokens in constant time", () => {
    const hash = hashVerifySecret("482910");
    expect(verifySecretConstantTime("482910", hash)).toBe(true);
    expect(verifySecretConstantTime("000000", hash)).toBe(false);

    const token = signUnsubscribeToken("550e8400-e29b-41d4-a716-446655440000");
    expect(verifyUnsubscribeToken(token)).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(verifyUnsubscribeToken(`${token}x`)).toBeNull();
  });

  it("masks secrets in display destinations", () => {
    expect(maskDestination("discord", "https://discord.com/api/webhooks/12345/abcdef1234")).toBe(
      "https://discord.com/api/webhooks/12345/••••1234",
    );
    expect(maskDestination("email", "alice@example.com")).toBe("al***@example.com");
    expect(maskDestination("whatsapp", "+14155550123")).toBe("+141••••123");
  });
});
