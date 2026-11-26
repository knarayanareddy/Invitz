"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { shareInvite, type ShareState } from "@/app/actions/invites";

type G = { id: string; name: string; slug: string; type: string; description: string };

export function ShareForm({
  everyone,
  topics,
  mine,
  preselect,
}: {
  everyone: G[];
  topics: G[];
  mine: G[];
  preselect: string[];
}) {
  const [state, action, pending] = useActionState<ShareState, FormData>(shareInvite, {});
  const initialSelected = state.values?.groupIds ?? preselect;
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelected);
  const [noteLen, setNoteLen] = useState<number>((state.values?.note ?? "").length);

  const selectedSet = new Set(selectedIds);

  const toggleGroup = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return Array.from(next);
    });
  };

  const renderGroupPill = (g: G, badge?: string) => {
    const isChecked = selectedSet.has(g.id);
    return (
      <label
        key={g.id}
        className={`flex cursor-pointer items-center gap-2.5 px-3.5 py-2 text-sm transition ${
          isChecked
            ? "inv-surface-selected border border-[var(--inv-accent)] font-semibold shadow-2xs"
            : "inv-chip"
        }`}
        style={{ borderRadius: "var(--inv-radius-btn)" }}
      >
        <input
          type="checkbox"
          name="group"
          value={g.id}
          checked={isChecked}
          onChange={(e) => toggleGroup(g.id, e.target.checked)}
          className="h-4 w-4 accent-[var(--inv-accent)]"
        />
        <span>{g.name}</span>
        {badge && (
          <span className="inv-mono rounded-full bg-black/10 px-2 py-0.5 text-[10px] uppercase">
            {badge}
          </span>
        )}
      </label>
    );
  };

  return (
    <form action={action} className="space-y-6">
      {state.error && (
        <p
          role="alert"
          className="inv-verdict-rejected px-4 py-3 text-sm font-medium"
          style={{ borderRadius: "var(--inv-radius-input)" }}
        >
          {state.error}
        </p>
      )}

      {/* Step 1: Event URL */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="url" className="text-sm font-semibold">
            1. Event link
          </label>
          <span className="inv-mono text-xs inv-text-muted">HTTPS required · Any platform</span>
        </div>
        <input
          id="url"
          name="url"
          required
          defaultValue={state.values?.url ?? ""}
          placeholder="https://lu.ma/… or eventbrite.com/… or any organiser page"
          className="inv-input w-full px-3.5 py-2.5 text-sm"
        />
        <p className="text-xs inv-text-muted">
          Works with Luma, Eventbrite, Meetup, Partiful, university pages, or independent websites.
        </p>
      </div>

      {/* Step 2: Curator Note */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="note" className="text-sm font-semibold">
            2. Why should people go?{" "}
            <span className="font-normal inv-text-muted">(optional)</span>
          </label>
          <span className="inv-mono text-xs inv-text-muted">{noteLen}/500</span>
        </div>
        <textarea
          id="note"
          name="note"
          rows={3}
          maxLength={500}
          defaultValue={state.values?.note ?? ""}
          onChange={(e) => setNoteLen(e.target.value.length)}
          placeholder="Share context: who’s speaking, why this edition stands out, or who will get the most out of it."
          className="inv-input w-full px-3.5 py-2.5 text-sm"
        />
      </div>

      {/* Step 3: Audience Picker */}
      <fieldset className="space-y-4 border-t border-[var(--inv-border)] pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <legend className="text-sm font-semibold">
            3. Who should see it?
          </legend>
          <span className="inv-chip inv-mono px-2.5 py-0.5 text-xs font-semibold">
            {selectedIds.length} {selectedIds.length === 1 ? "audience" : "audiences"} selected
          </span>
        </div>

        <div className="space-y-1.5">
          <p className="inv-kicker">Wide discovery</p>
          <div className="flex flex-wrap gap-2">
            {everyone.map((g) => renderGroupPill(g, "public"))}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="inv-kicker">Curated topic communities</p>
          <div className="flex flex-wrap gap-2">
            {topics.map((g) => renderGroupPill(g))}
          </div>
        </div>

        {mine.length > 0 && (
          <div className="space-y-1.5">
            <p className="inv-kicker">My custom groups</p>
            <div className="flex flex-wrap gap-2">
              {mine.map((g) => renderGroupPill(g, "circle"))}
            </div>
          </div>
        )}
      </fieldset>

      {/* Pre-Notification QC Pipeline Preview */}
      <div className="inv-surface-subtle space-y-3 p-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inv-kicker">Pre-notification Quality Control</span>
          <Link href="/guidelines" className="font-medium underline inv-text-secondary">
            Inspect full QC rulebook →
          </Link>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-3">
          <div className="inv-card p-3">
            <p className="inv-mono text-[11px] font-semibold text-[var(--inv-accent)]">01 · RULES</p>
            <p className="mt-0.5 font-semibold">Safety &amp; behavior</p>
            <p className="inv-text-muted mt-0.5">
              HTTPS check, SSRF guard, domain reputation, and duplicate prevention.
            </p>
          </div>
          <div className="inv-card p-3">
            <p className="inv-mono text-[11px] font-semibold text-[var(--inv-accent)]">02 · METADATA</p>
            <p className="mt-0.5 font-semibold">Event signal extraction</p>
            <p className="inv-text-muted mt-0.5">
              Fetches title, date, location, and structured schema.org event metadata.
            </p>
          </div>
          <div className="inv-card p-3">
            <p className="inv-mono text-[11px] font-semibold text-[var(--inv-accent)]">03 · VERDICT</p>
            <p className="mt-0.5 font-semibold">AI verification</p>
            <p className="inv-text-muted mt-0.5">
              Labels clean events <b>Verified</b>, weak signals <b>Proceed with caution</b>, and blocks spam.
            </p>
          </div>
        </div>
      </div>

      {/* Submit Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-xs inv-text-muted">
          {pending
            ? "Fetching event page, running deterministic rules, and evaluating trust signals…"
            : "Members are only pinged after quality checks complete."}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="inv-btn-primary px-6 py-2.5 text-sm disabled:opacity-60"
        >
          {pending ? "Checking the link…" : "Run QC & share"}
        </button>
      </div>
    </form>
  );
}
