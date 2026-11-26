import { describe, expect, it } from "vitest";
import {
  getLocalParts,
  isValidTimeZone,
  isWithinQuietHours,
  localDayStartUtc,
  nextDigestBucket,
  nextQuietHoursEndUtc,
} from "@/lib/notify/schedule";

describe("notification quiet hours, timezones, and digest buckets", () => {
  it("validates IANA time zones cleanly", () => {
    expect(isValidTimeZone("Europe/Amsterdam")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });

  it("evaluates overnight quiet hours across 3 time zones", () => {
    // 2026-11-26T22:30:00Z -> UTC: 22:30 (quiet), Amsterdam (CET +1): 23:30 (quiet), New York (EST -5): 17:30 (active)
    const now = new Date("2026-11-26T22:30:00.000Z");
    expect(isWithinQuietHours(now, "22:00", "08:00", "UTC")).toBe(true);
    expect(isWithinQuietHours(now, "22:00", "08:00", "Europe/Amsterdam")).toBe(true);
    expect(isWithinQuietHours(now, "22:00", "08:00", "America/New_York")).toBe(false);
  });

  it("computes nextQuietHoursEndUtc cleanly to local end time", () => {
    const now = new Date("2026-11-26T23:15:00.000Z"); // 00:15 next day in Europe/Amsterdam (+01:00)
    const endUtc = nextQuietHoursEndUtc(now, "22:00", "08:00", "Europe/Amsterdam");
    const endLocal = getLocalParts(endUtc, "Europe/Amsterdam");
    expect(endLocal.hour).toBe(8);
    expect(endLocal.minute).toBe(0);
    expect(endUtc.getTime()).toBeGreaterThan(now.getTime());
  });

  it("schedules hourly, daily, and weekly digest buckets outside quiet hours", () => {
    const now = new Date("2026-11-26T10:20:00.000Z"); // Thu 2026-11-26
    const hourly = nextDigestBucket("hourly", now, "UTC");
    expect(hourly.toISOString()).toBe("2026-11-26T11:00:00.000Z");

    const daily = nextDigestBucket("daily", now, "UTC");
    expect(daily.toISOString()).toBe("2026-11-27T09:00:00.000Z");

    const weekly = nextDigestBucket("weekly", now, "UTC");
    expect(getLocalParts(weekly, "UTC").weekday).toBe(1); // Monday
    expect(getLocalParts(weekly, "UTC").hour).toBe(9);
  });

  it("computes localDayStartUtc accurately for cap counting", () => {
    const now = new Date("2026-11-26T02:30:00.000Z");
    const startUtc = localDayStartUtc(now, "America/New_York"); // 21:30 previous day EST -> day started 2026-11-25T05:00:00Z
    const parts = getLocalParts(startUtc, "America/New_York");
    expect(parts.hour).toBe(0);
    expect(parts.minute).toBe(0);
    expect(parts.day).toBe(25);
  });
});
