"use server";

import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { groupMembers, groups, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/url";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "group";
}

function parseHandles(raw: string) {
  return [...new Set(raw.split(/[\s,]+/).map((h) => h.replace(/^@/, "").toLowerCase()).filter(Boolean))].slice(0, 100);
}

export async function createGroup(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim().slice(0, 300);
  const visibility = formData.get("visibility") === "public" ? "public" : "private";
  if (name.length < 3 || name.length > 50) {
    redirect(`/groups?error=${encodeURIComponent("Group names need 3–50 characters.")}`);
  }

  const handles = parseHandles(String(formData.get("members") ?? ""));
  const slug = `${slugify(name)}-${randomBytes(3).toString("hex")}`;

  const { group, missingCount } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(groups)
      .values({ slug, name, description, type: "custom", visibility, ownerId: user.id })
      .returning();
    await tx.insert(groupMembers).values({ groupId: created.id, userId: user.id, role: "owner" });

    let missing = 0;
    if (handles.length) {
      const found = await tx.select({ id: users.id, handle: users.handle }).from(users).where(inArray(users.handle, handles));
      const foundHandles = new Set(found.map((f) => f.handle));
      missing = handles.filter((h) => !foundHandles.has(h)).length;
      const others = found.filter((f) => f.id !== user.id);
      if (others.length) {
        await tx
          .insert(groupMembers)
          .values(others.map((f) => ({ groupId: created.id, userId: f.id })))
          .onConflictDoNothing();
      }
    }
    return { group: created, missingCount: missing };
  });

  revalidatePath("/", "layout");
  redirect(missingCount > 0 ? `/groups/${group.slug}?warn=${encodeURIComponent(`${missingCount} handle(s) were not found.`)}` : `/groups/${group.slug}`);
}

export async function joinGroup(formData: FormData) {
  const user = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  if (!isUuid(groupId)) redirect("/groups");
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group || group.visibility !== "public") redirect("/groups");
  await db.insert(groupMembers).values({ groupId, userId: user.id }).onConflictDoNothing();
  revalidatePath("/", "layout");
  redirect(`/groups/${group.slug}`);
}

export async function leaveGroup(formData: FormData) {
  const user = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  if (!isUuid(groupId)) redirect("/groups");
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) redirect("/groups");
  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id), eq(groupMembers.role, "member")));
  revalidatePath("/", "layout");
  redirect("/groups");
}

export async function toggleMute(formData: FormData) {
  const user = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  if (!isUuid(groupId)) return;
  const muted = formData.get("muted") === "true";
  await db
    .update(groupMembers)
    .set({ muted: !muted })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)));
  revalidatePath("/", "layout");
}

export async function addMembers(formData: FormData) {
  const user = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  if (!isUuid(groupId)) redirect("/groups");
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group || group.ownerId !== user.id) redirect("/groups");
  const handles = parseHandles(String(formData.get("handles") ?? ""));
  if (handles.length) {
    const found = await db.select({ id: users.id }).from(users).where(inArray(users.handle, handles));
    if (found.length) {
      await db.insert(groupMembers).values(found.map((f) => ({ groupId, userId: f.id }))).onConflictDoNothing();
    }
  }
  revalidatePath(`/groups/${group.slug}`);
  revalidatePath("/groups");
}

export async function removeMember(formData: FormData) {
  const user = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!isUuid(groupId) || !isUuid(userId)) redirect("/groups");
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group || group.ownerId !== user.id || userId === user.id) redirect("/groups");
  await db.delete(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  revalidatePath(`/groups/${group.slug}`);
  revalidatePath("/groups");
}
