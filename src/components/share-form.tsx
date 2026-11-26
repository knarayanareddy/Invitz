"use client";

import { useActionState } from "react";
import { shareInvite, type ShareState } from "@/app/actions/invites";

type G = { id: string; name: string; slug: string; type: string; description: string };

export function ShareForm({ everyone, topics, mine, preselect }: { everyone: G[]; topics: G[]; mine: G[]; preselect: string[] }) {
  const [state, action, pending] = useActionState<ShareState, FormData>(shareInvite, {});
  const selected = new Set(state.values?.groupIds ?? preselect);

  const Group = ({ g }: { g: G }) => (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm has-[:checked]:border-violet-500 has-[:checked]:bg-violet-50">
      <input type="checkbox" name="group" value={g.id} defaultChecked={selected.has(g.id)} className="accent-violet-600" />
      {g.name}
    </label>
  );

  return (
    <form action={action} className="space-y-6">
      {state.error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">{state.error}</p>
      )}
      <div>
        <label htmlFor="url" className="mb-1 block text-sm font-medium text-stone-800">Event link</label>
        <input
          id="url" name="url" required defaultValue={state.values?.url ?? ""} placeholder="https://… (any platform, any organiser)"
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
        />
      </div>
      <div>
        <label htmlFor="note" className="mb-1 block text-sm font-medium text-stone-800">Why should people go? <span className="font-normal text-stone-500">(optional)</span></label>
        <textarea
          id="note" name="note" rows={3} maxLength={500} defaultValue={state.values?.note ?? ""}
          placeholder="A line or two on why this is worth their time."
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-stone-800">Who should see it?</legend>
        <div className="flex flex-wrap gap-2">{everyone.map((g) => <Group key={g.id} g={g} />)}</div>
        <p className="pt-1 text-xs font-medium uppercase tracking-wide text-stone-500">Communities</p>
        <div className="flex flex-wrap gap-2">{topics.map((g) => <Group key={g.id} g={g} />)}</div>
        {mine.length > 0 && (
          <>
            <p className="pt-1 text-xs font-medium uppercase tracking-wide text-stone-500">My custom groups</p>
            <div className="flex flex-wrap gap-2">{mine.map((g) => <Group key={g.id} g={g} />)}</div>
          </>
        )}
      </fieldset>

      <div className="rounded-xl bg-stone-100 px-4 py-3 text-xs text-stone-600">
        Every share goes through Invitz QC: rule checks plus an AI review of the page. Clean invites are marked <b>Verified</b>; if we
        can’t be confident they’re labelled <b>proceed with caution</b>; clear spam is blocked.
      </div>

      <button
        disabled={pending}
        className="rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
      >
        {pending ? "Checking the link…" : "Run QC & share"}
      </button>
    </form>
  );
}
