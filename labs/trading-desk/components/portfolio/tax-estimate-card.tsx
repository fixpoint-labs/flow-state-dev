/**
 * TaxEstimateCard — the household-level realized-gains tax preview (FIX-874). A
 * standalone card in the Gains & Taxes section (`GainsTaxesSection`, FIX-885):
 * a headline estimated-tax figure, a federal/state + bucket breakdown, the
 * effective rates from the saved profile, the estimator's assumptions as
 * caveats, and a prominent NOT-ADVICE disclaimer.
 *
 * Pure presentational. The parent (`PortfolioPane`) owns the read (`useTax`) and
 * the profile-edit dialog; this component only formats and calls
 * `onEditProfile`. Real-money gate: when no profile is set the estimate is all
 * zeros, so the headline shows a "set your profile" prompt — NOT a fabricated
 * $0. A set profile with genuinely no gains does show $0 (that is a real number).
 */
"use client";

import type { ReactElement } from "react";
import { Pencil } from "lucide-react";
import type { TaxProfileRow } from "@/src/db/repository";
import type { TaxEstimate } from "@/src/flows/portfolio/tax-estimate";
import { formatMoney, formatPercent } from "./portfolio-format";

type TaxEstimateCardProps = {
  /** The current-year estimate; null until loaded. */
  estimate: TaxEstimate | null;
  /** The saved tax profile; null when unset (drives the prompt vs. the figure). */
  profile: TaxProfileRow | null;
  /** Open the tax-profile editor. */
  onEditProfile: () => void;
};

const labelClass =
  "font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]";
const valueClass = "font-mono text-[12px] tabular-nums text-[color:var(--c-fg)]";

function EditProfileButton({ onEditProfile }: { onEditProfile: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onEditProfile}
      className="inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2.5 text-[11.5px] font-medium hover:bg-[color:var(--c-surface-2)]"
    >
      <Pencil className="h-3 w-3" aria-hidden /> Edit tax profile
    </button>
  );
}

/** One label/value stat in the breakdown grid. */
function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={labelClass}>{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

export function TaxEstimateCard({
  estimate,
  profile,
  onEditProfile,
}: TaxEstimateCardProps): ReactElement {
  // No profile (or nothing loaded yet) → prompt to set one. The estimate is all
  // zeros without a profile, so showing its $0 headline would fabricate a figure.
  if (estimate === null || profile === null) {
    return (
      <section className="rounded-lg border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-[13px] font-semibold text-[color:var(--c-fg)]">
              Realized gains &amp; tax impact
            </h3>
            <p className="text-[11.5px] text-[color:var(--c-fg-muted)]">
              Add your tax profile to see an estimate.
            </p>
          </div>
          <EditProfileButton onEditProfile={onEditProfile} />
        </div>
        <p className="mt-3 text-[10px] text-[color:var(--c-fg-faint)]">
          Rough planning estimate — not tax advice.
        </p>
      </section>
    );
  }

  const currency = "USD";

  return (
    <section className="rounded-lg border border-[color:var(--c-border)] bg-[color:var(--c-surface)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--c-border)] px-4 py-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-[13px] font-semibold text-[color:var(--c-fg)]">
            Estimated {estimate.year} tax on realized gains
          </h3>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[22px] font-semibold tabular-nums text-[color:var(--c-fg)]">
              {formatMoney(estimate.estimatedTotal, currency)}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              estimated total
            </span>
          </div>
        </div>
        <EditProfileButton onEditProfile={onEditProfile} />
      </header>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3 @xl:grid-cols-4">
        <Stat label="Federal" value={formatMoney(estimate.estimatedFederal, currency)} />
        <Stat label="State" value={formatMoney(estimate.estimatedState, currency)} />
        <Stat
          label="Ordinary bucket"
          value={formatMoney(estimate.ordinaryTaxable, currency)}
        />
        <Stat label="LTCG bucket" value={formatMoney(estimate.ltcgTaxable, currency)} />
        <Stat
          label="Net short-term"
          value={formatMoney(estimate.netShortTerm, currency)}
        />
        <Stat
          label="Net long-term"
          value={formatMoney(estimate.netLongTerm, currency)}
        />
        {estimate.lossCarryforward > 0 ? (
          <Stat
            label="Loss carryforward"
            value={formatMoney(estimate.lossCarryforward, currency)}
          />
        ) : null}
      </div>

      {/* Effective rates from the saved profile. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[color:var(--c-border)] px-4 py-2 font-mono text-[10.5px] text-[color:var(--c-fg-muted)]">
        <span>
          ordinary{" "}
          <span className="text-[color:var(--c-fg)]">
            {formatPercent(estimate.effectiveOrdinaryRate)}
          </span>
        </span>
        <span>
          LTCG{" "}
          <span className="text-[color:var(--c-fg)]">
            {formatPercent(estimate.effectiveLtcgRate)}
          </span>
        </span>
        <span>
          state{" "}
          <span className="text-[color:var(--c-fg)]">
            {formatPercent(estimate.effectiveStateRate)}
          </span>
        </span>
      </div>

      {/* Assumptions/caveats from the estimator. */}
      {estimate.assumptions.length > 0 ? (
        <ul className="space-y-1 border-t border-[color:var(--c-border)] px-4 py-2">
          {estimate.assumptions.map((a, i) => (
            <li key={i} className="text-[10px] leading-snug text-[color:var(--c-fg-faint)]">
              {a}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Not-advice disclaimer (real-money gate) — always visible. */}
      <p className="border-t border-[color:var(--c-warn)]/30 bg-[color:var(--c-warn)]/5 px-4 py-2 text-[10.5px] font-medium text-[color:var(--c-warn)]">
        Rough planning estimate — not tax advice.
      </p>
    </section>
  );
}
