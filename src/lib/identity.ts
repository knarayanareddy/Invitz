export const RESERVED_HANDLES = new Set([
  "admin",
  "administrator",
  "api",
  "auth",
  "guidelines",
  "groups",
  "health",
  "help",
  "invitz",
  "login",
  "logout",
  "mod",
  "moderator",
  "notifications",
  "onboarding",
  "people",
  "privacy",
  "root",
  "security",
  "settings",
  "share",
  "signin",
  "signout",
  "signup",
  "support",
  "system",
  "terms",
]);

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "burnermail.io",
  "dispostable.com",
  "dropmail.me",
  "fakeinbox.com",
  "getnada.com",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "maildrop.cc",
  "mailinator.com",
  "mailinator.net",
  "mailnesia.com",
  "mintemail.com",
  "mohmal.com",
  "sharklasers.com",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "throwawaymail.com",
  "trashmail.com",
  "yopmail.com",
  "yopmail.fr",
]);

export const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const NEW_ACCOUNT_MAX_GROUPS = 3;
export const NEW_ACCOUNT_MAX_INVITES_PER_DAY = 3;
export const HANDLE_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export function validateHandle(
  raw: string,
): { ok: true; handle: string } | { ok: false; error: string } {
  const handle = raw.trim().replace(/^@/, "").toLowerCase();
  if (handle.length < 3 || handle.length > 20) {
    return { ok: false, error: "Handle must be 3–20 characters." };
  }
  if (!/^[a-z0-9_]+$/.test(handle)) {
    return { ok: false, error: "Handle can only contain lowercase letters, numbers, and underscores." };
  }
  if (/^_+$/.test(handle)) {
    return { ok: false, error: "Handle must contain at least one letter or number." };
  }
  if (RESERVED_HANDLES.has(handle)) {
    return { ok: false, error: "That handle is reserved." };
  }
  return { ok: true, handle };
}

export function slugifyHandle(input: string): string {
  const cleaned = input.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
  if (cleaned.length >= 3 && !RESERVED_HANDLES.has(cleaned) && !/^_+$/.test(cleaned)) {
    return cleaned;
  }
  const base = /^_*$/.test(cleaned) ? "member" : cleaned;
  const padded = `${base}_user`.slice(0, 20);
  return RESERVED_HANDLES.has(padded) ? "invitz_member" : padded;
}

export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return false;
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  for (const d of DISPOSABLE_EMAIL_DOMAINS) {
    if (domain.endsWith(`.${d}`)) return true;
  }
  return false;
}

export function isNewAccountRestricted(
  user: { createdAt: Date; trustScore: number },
  now = Date.now(),
): boolean {
  return now - user.createdAt.getTime() < NEW_ACCOUNT_WINDOW_MS && user.trustScore < 60;
}
