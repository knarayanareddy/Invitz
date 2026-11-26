import type { DigestMode } from "@/db/schema";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const COMMON_TIMEZONES = [
  "UTC",
  "Europe/Amsterdam",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

export function isValidTimeHHMM(value: string | null | undefined): boolean {
  if (!value) return false;
  return TIME_RE.test(value.trim());
}

export function parseTimeMinutes(value: string): number | null {
  const m = TIME_RE.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sun..6=Sat
};

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getLocalParts(date: Date, timeZone: string): LocalParts {
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "0";
  const hourRaw = Number(get("hour"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: hourRaw === 24 ? 0 : hourRaw,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_MAP[get("weekday")] ?? 0,
  };
}

/**
 * Checks whether `nowUtc` falls inside [quietStart, quietEnd) in the user's `timeZone`.
 * Supports both same-day (e.g. 13:00 -> 15:00) and overnight (e.g. 22:00 -> 08:00) windows.
 */
export function isWithinQuietHours(
  nowUtc: Date,
  quietStart: string | null | undefined,
  quietEnd: string | null | undefined,
  timeZone: string,
): boolean {
  if (!quietStart || !quietEnd) return false;
  const startMin = parseTimeMinutes(quietStart);
  const endMin = parseTimeMinutes(quietEnd);
  if (startMin === null || endMin === null || startMin === endMin) return false;

  const local = getLocalParts(nowUtc, timeZone);
  const curMin = local.hour * 60 + local.minute;
  if (startMin < endMin) {
    return curMin >= startMin && curMin < endMin;
  }
  return curMin >= startMin || curMin < endMin;
}

/**
 * Computes the next UTC Date when quiet hours end (or `nowUtc` if not currently in quiet hours).
 * Uses iterative minute-offset refinement so DST transitions in any IANA zone are exact.
 */
export function nextQuietHoursEndUtc(
  nowUtc: Date,
  quietStart: string | null | undefined,
  quietEnd: string | null | undefined,
  timeZone: string,
): Date {
  if (!isWithinQuietHours(nowUtc, quietStart, quietEnd, timeZone) || !quietEnd) {
    return nowUtc;
  }
  const endMin = parseTimeMinutes(quietEnd);
  if (endMin === null) return nowUtc;

  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const local = getLocalParts(nowUtc, tz);
  const curMin = local.hour * 60 + local.minute;
  const deltaMinutes = curMin < endMin ? endMin - curMin : 1440 - curMin + endMin;
  let candidate = new Date(nowUtc.getTime() + deltaMinutes * 60_000 - local.second * 1000);

  // Refine up to 2 steps in case a DST jump occurred across midnight.
  for (let i = 0; i < 2; i++) {
    const cLocal = getLocalParts(candidate, tz);
    const cMin = cLocal.hour * 60 + cLocal.minute;
    const diff = endMin - cMin;
    if (diff === 0) break;
    const wrappedDiff = diff < -720 ? diff + 1440 : diff > 720 ? diff - 1440 : diff;
    candidate = new Date(candidate.getTime() + wrappedDiff * 60_000);
  }
  return candidate;
}

/**
 * Computes UTC timestamp of 00:00:00 of the current local day in `timeZone`.
 */
export function localDayStartUtc(nowUtc: Date, timeZone: string): Date {
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const local = getLocalParts(nowUtc, tz);
  const elapsedMs = ((local.hour * 60 + local.minute) * 60 + local.second) * 1000;
  return new Date(nowUtc.getTime() - elapsedMs);
}

/**
 * Computes the next scheduled UTC time for hourly, daily (09:00 local), or weekly (Mon 09:00 local) digests,
 * pushed outside quiet hours if the digest target would land inside quiet hours.
 */
export function nextDigestBucket(
  mode: DigestMode,
  nowUtc: Date,
  timeZone: string,
  quietStart?: string | null,
  quietEnd?: string | null,
): Date {
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  if (mode === "instant") {
    return nextQuietHoursEndUtc(nowUtc, quietStart, quietEnd, tz);
  }

  let target: Date;
  if (mode === "hourly") {
    const local = getLocalParts(nowUtc, tz);
    const minsLeft = 60 - local.minute;
    target = new Date(nowUtc.getTime() + minsLeft * 60_000 - local.second * 1000);
  } else if (mode === "daily") {
    // Next 09:00 local time
    const local = getLocalParts(nowUtc, tz);
    const targetMin = 9 * 60;
    const curMin = local.hour * 60 + local.minute;
    const delta = curMin < targetMin ? targetMin - curMin : 1440 - curMin + targetMin;
    target = new Date(nowUtc.getTime() + delta * 60_000 - local.second * 1000);
  } else {
    // Weekly: next Monday 09:00 local time
    const local = getLocalParts(nowUtc, tz);
    const targetMin = 9 * 60;
    const curMin = local.hour * 60 + local.minute;
    let daysUntilMon = (1 - local.weekday + 7) % 7;
    if (daysUntilMon === 0 && curMin >= targetMin) {
      daysUntilMon = 7;
    }
    const deltaMin = daysUntilMon * 1440 + (targetMin - curMin);
    target = new Date(nowUtc.getTime() + deltaMin * 60_000 - local.second * 1000);
  }

  return nextQuietHoursEndUtc(target, quietStart, quietEnd, tz);
}
