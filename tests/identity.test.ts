import { describe, expect, it } from "vitest";
import {
  isDisposableEmail,
  isNewAccountRestricted,
  slugifyHandle,
  validateHandle,
} from "@/lib/identity";

describe("validateHandle", () => {
  it("accepts valid 3-20 lowercase alphanumeric/underscore handles and strips leading @", () => {
    expect(validateHandle("@Ada_Okafor")).toEqual({ ok: true, handle: "ada_okafor" });
    expect(validateHandle("ml_2026")).toEqual({ ok: true, handle: "ml_2026" });
  });

  it("rejects invalid lengths, symbols, underscore-only, and reserved words", () => {
    expect(validateHandle("ab").ok).toBe(false);
    expect(validateHandle("a".repeat(21)).ok).toBe(false);
    expect(validateHandle("bad-handle").ok).toBe(false);
    expect(validateHandle("___").ok).toBe(false);
    expect(validateHandle("admin").ok).toBe(false);
    expect(validateHandle("settings").ok).toBe(false);
  });
});

describe("slugifyHandle", () => {
  it("derives valid non-reserved handles from arbitrary names", () => {
    expect(slugifyHandle("Ada Okafor")).toBe("adaokafor");
    expect(slugifyHandle("admin")).toBe("admin_user");
    expect(slugifyHandle("x")).toBe("x_user");
    expect(slugifyHandle("___")).toBe("member_user");
  });
});

describe("isDisposableEmail", () => {
  it("detects throwaway email domains including subdomains", () => {
    expect(isDisposableEmail("spammer@mailinator.com")).toBe(true);
    expect(isDisposableEmail("user@sub.yopmail.com")).toBe(true);
    expect(isDisposableEmail("founder@climate-company.com")).toBe(false);
  });
});

describe("isNewAccountRestricted", () => {
  it("restricts accounts under 24h old with default trustScore, relaxes after 24h or higher trust", () => {
    const now = Date.now();
    expect(isNewAccountRestricted({ createdAt: new Date(now - 3600_000), trustScore: 50 }, now)).toBe(true);
    expect(isNewAccountRestricted({ createdAt: new Date(now - 25 * 3600_000), trustScore: 50 }, now)).toBe(false);
    expect(isNewAccountRestricted({ createdAt: new Date(now - 3600_000), trustScore: 65 }, now)).toBe(false);
  });
});
