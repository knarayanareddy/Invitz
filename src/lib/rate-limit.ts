import { sql } from "drizzle-orm";
import { db } from "@/db";
import { authRateLimits } from "@/db/schema";

export async function consumeAuthRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const now = new Date();
  const nextReset = new Date(now.getTime() + windowMs);

  const [row] = await db
    .insert(authRateLimits)
    .values({ key, count: 1, resetAt: nextReset })
    .onConflictDoUpdate({
      target: authRateLimits.key,
      set: {
        count: sql`CASE WHEN ${authRateLimits.resetAt} <= ${now} THEN 1 ELSE ${authRateLimits.count} + 1 END`,
        resetAt: sql`CASE WHEN ${authRateLimits.resetAt} <= ${now} THEN ${nextReset} ELSE ${authRateLimits.resetAt} END`,
      },
    })
    .returning({ count: authRateLimits.count, resetAt: authRateLimits.resetAt });

  return {
    allowed: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
    resetAt: row.resetAt,
  };
}
