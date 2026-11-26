import { randomBytes } from "node:crypto";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq, sql } from "drizzle-orm";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { db, getDb } from "@/db";
import { accounts, groupMembers, groups, sessions, users, verificationTokens } from "@/db/schema";
import { slugifyHandle } from "@/lib/identity";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

function toAdapterUser(row: typeof users.$inferSelect): AdapterUser {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    name: row.name ?? row.displayName,
    image: row.image,
  };
}

export function createInvitzAdapter(): Adapter {
  let base: Adapter | null = null;
  const getBase = (): Adapter => {
    if (!base) {
      base = DrizzleAdapter(getDb(), {
        usersTable: users,
        accountsTable: accounts,
        sessionsTable: sessions,
        verificationTokensTable: verificationTokens,
      });
    }
    return base;
  };

  return {
    getUser: (id) => getBase().getUser!(id),
    getUserByAccount: (account) => getBase().getUserByAccount!(account),
    createSession: (session) => getBase().createSession!(session),
    getSessionAndUser: (sessionToken) => getBase().getSessionAndUser!(sessionToken),
    updateSession: (session) => getBase().updateSession!(session),
    deleteSession: (sessionToken) => getBase().deleteSession!(sessionToken),
    createVerificationToken: (token) => getBase().createVerificationToken!(token),
    useVerificationToken: (params) => getBase().useVerificationToken!(params),
    linkAccount: (account) => getBase().linkAccount!(account),
    unlinkAccount: (params) => getBase().unlinkAccount!(params),
    deleteUser: (userId) => getBase().deleteUser!(userId),

    async getUserByEmail(email) {
      const normalized = email.trim().toLowerCase();
      const [row] = await db
        .select()
        .from(users)
        .where(eq(sql`lower(${users.email})`, normalized))
        .limit(1);
      return row ? toAdapterUser(row) : null;
    },

    async createUser(data) {
      const email = data.email.trim().toLowerCase();
      const seedName = data.name?.trim() || email.split("@")[0] || "member";
      const baseHandle = slugifyHandle(seedName);

      return db.transaction(async (tx) => {
        let created: typeof users.$inferSelect | undefined;
        for (let attempt = 0; attempt < 8; attempt++) {
          const handle =
            attempt === 0
              ? baseHandle
              : `${baseHandle.slice(0, 15)}_${randomBytes(2).toString("hex")}`;
          try {
            [created] = await tx
              .insert(users)
              .values({
                email,
                emailVerified: data.emailVerified ?? null,
                name: data.name ?? null,
                image: data.image ?? null,
                handle,
                displayName: (data.name?.trim() || handle).slice(0, 60),
              })
              .returning();
            break;
          } catch (err) {
            if (!isUniqueViolation(err)) throw err;
            const [existing] = await tx
              .select()
              .from(users)
              .where(eq(sql`lower(${users.email})`, email))
              .limit(1);
            if (existing) {
              created = existing;
              break;
            }
          }
        }
        if (!created) {
          throw new Error("Could not allocate a unique handle for new account.");
        }

        const [general] = await tx
          .select({ id: groups.id })
          .from(groups)
          .where(eq(groups.slug, "general"))
          .limit(1);
        if (general) {
          await tx
            .insert(groupMembers)
            .values({ groupId: general.id, userId: created.id })
            .onConflictDoNothing();
        }
        return toAdapterUser(created);
      });
    },

    async updateUser(data) {
      if (!data.id) throw new Error("No user id.");
      const patch: Partial<typeof users.$inferInsert> = {};
      if (data.email !== undefined) patch.email = data.email.trim().toLowerCase();
      if (data.emailVerified !== undefined) patch.emailVerified = data.emailVerified;
      if (data.name !== undefined) patch.name = data.name;
      if (data.image !== undefined) patch.image = data.image;

      const [updated] = await db
        .update(users)
        .set(patch)
        .where(eq(users.id, data.id))
        .returning();
      if (!updated) throw new Error("No user found.");
      return toAdapterUser(updated);
    },
  };
}
