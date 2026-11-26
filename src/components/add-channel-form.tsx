"use client";

import { useState } from "react";
import { addChannel } from "@/app/actions/settings";

type ChannelOption = {
  type: string;
  label: string;
  placeholder: string;
  beta?: boolean;
  consentRequired?: boolean;
  disabledReason?: string | null;
};

export function AddChannelForm({
  options,
  consentText,
  inputCls,
}: {
  options: ChannelOption[];
  consentText: string;
  inputCls: string;
}) {
  const [selected, setSelected] = useState(options[0]?.type ?? "discord");
  const current = options.find((o) => o.type === selected) ?? options[0];

  return (
    <form action={addChannel} className="mt-5 space-y-3 border-t border-[var(--inv-border)] pt-5">
      <div className="grid gap-2.5 sm:grid-cols-[160px_1fr_140px_auto]">
        <select
          name="type"
          aria-label="Channel type"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className={inputCls}
        >
          {options.map((o) => (
            <option key={o.type} value={o.type}>
              {o.label}
              {o.beta ? " (Beta)" : ""}
            </option>
          ))}
        </select>

        <input
          name="destination"
          aria-label="Channel destination"
          required={selected !== "telegram"}
          placeholder={
            selected === "telegram"
              ? "Chat ID / @channel (or leave blank for bot link)"
              : current?.placeholder ?? "Destination"
          }
          className={inputCls}
        />

        <select name="digestMode" aria-label="Channel digest frequency" defaultValue="" className={inputCls}>
          <option value="">Default timing</option>
          <option value="instant">Instant</option>
          <option value="hourly">Hourly digest</option>
          <option value="daily">Daily digest</option>
          <option value="weekly">Weekly digest</option>
        </select>

        <button type="submit" disabled={Boolean(current?.disabledReason)} className="inv-btn-primary px-5 py-2 text-sm disabled:opacity-50">
          {selected === "telegram" ? "Connect" : "Add"}
        </button>
      </div>

      {current?.disabledReason && (
        <p className="text-xs font-medium text-[var(--inv-caution-text)]">{current.disabledReason}</p>
      )}

      {selected === "whatsapp" && (
        <label className="inv-surface-subtle flex cursor-pointer items-start gap-2.5 p-3 text-xs inv-text-secondary">
          <input type="checkbox" name="whatsappConsent" value="true" required className="mt-0.5" />
          <span>{consentText}</span>
        </label>
      )}

      {selected === "signal" && (
        <p className="inv-text-muted text-xs">
          Signal delivery is in <strong>Beta</strong> (rate-limited to 1 message/sec; email fallback applies automatically if delivery fails).
        </p>
      )}

      {selected === "telegram" && (
        <p className="inv-text-muted text-xs">
          Leave the destination empty and click <strong>Connect</strong> to generate a one-tap <code className="inv-mono">/start</code> bot link, or enter a public <code className="inv-mono">@channel</code> / numeric chat ID.
        </p>
      )}
    </form>
  );
}
