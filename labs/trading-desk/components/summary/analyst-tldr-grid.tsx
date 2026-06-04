/**
 * AnalystTldrGrid — one row per Phase 1 analyst: badge, role, headline (TLDR),
 * stance chip, data-quality chip, and up to two key metrics.
 *
 * Reads only stored analyst-memo fields via the aggregate. A missing/error/
 * unavailable memo shows the role with a muted "no usable data" line and an
 * (absent) dq chip — a missing signal reads as missing, never as a real value
 * (BP-020 at the UI layer). The dq chip makes provenance visible per the
 * real-money gate.
 */
import type { CSSProperties, ReactElement } from "react";
import type { AnalystTldr } from "./aggregate";
import { cn } from "@/lib/utils";

export type AnalystTldrGridProps = {
  analysts: ReadonlyArray<AnalystTldr>;
};

const STANCE_STYLE: Record<
  NonNullable<AnalystTldr["stance"]>,
  { glyph: string; cls: string }
> = {
  constructive: { glyph: "▲", cls: "text-[color:var(--c-live)]" },
  neutral: { glyph: "●", cls: "text-[color:var(--c-fg-muted)]" },
  cautious: { glyph: "▼", cls: "text-[color:var(--c-warn)]" },
};

export function AnalystTldrGrid({
  analysts,
}: AnalystTldrGridProps): ReactElement {
  return (
    <section
      className={cn(
        "flex flex-col divide-y overflow-hidden rounded-md border",
        "divide-[color:var(--c-border)] border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Analyst TLDRs"
    >
      {analysts.map((a) => (
        <AnalystRow key={a.shortName} analyst={a} />
      ))}
    </section>
  );
}

function AnalystRow({ analyst }: { analyst: AnalystTldr }): ReactElement {
  const badgeStyle = {
    "--c": `oklch(62% 0.12 ${analyst.hue})`,
  } as CSSProperties & { "--c": string };
  const stance = analyst.stance !== null ? STANCE_STYLE[analyst.stance] : null;
  const missing =
    analyst.headline === null ||
    analyst.status === "error" ||
    analyst.dataQuality === "unavailable";

  return (
    <div className="flex items-start gap-3 p-2.5">
      <span
        role="img"
        aria-label={analyst.role}
        title={analyst.role}
        style={badgeStyle}
        className={cn(
          "mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1",
          "border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]",
          "font-mono text-[10.5px] tracking-tight text-[color:var(--c)]",
        )}
      >
        {analyst.glyph}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          {analyst.role}
        </span>
        {missing ? (
          <span className="text-[12px] italic text-[color:var(--c-fg-faint)]">
            no usable data for this analyst
          </span>
        ) : (
          <span className="text-[12.5px] leading-snug text-[color:var(--c-fg)]">
            {analyst.headline}
          </span>
        )}
        {analyst.topMetrics.length > 0 ? (
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {analyst.topMetrics.map((m) => (
              <span
                key={m.key}
                className="font-mono text-[10px] text-[color:var(--c-fg-muted)]"
              >
                <span className="uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                  {m.key}
                </span>{" "}
                {m.value}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {stance !== null ? (
          <span
            className={cn("font-mono text-[10.5px]", stance.cls)}
            title={analyst.stance ?? undefined}
          >
            {stance.glyph} {analyst.stance}
          </span>
        ) : null}
        {analyst.dataQuality !== null ? (
          <DataQualityChip dq={analyst.dataQuality} />
        ) : null}
      </div>
    </div>
  );
}

function DataQualityChip({
  dq,
}: {
  dq: NonNullable<AnalystTldr["dataQuality"]>;
}): ReactElement {
  return (
    <span
      className={cn(
        "rounded px-1 py-px font-mono text-[8.5px] uppercase tracking-wider",
        dq === "unavailable"
          ? "border border-[color:var(--c-warn)]/50 bg-[color:var(--c-warn)]/10 text-[color:var(--c-warn)]"
          : "border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] text-[color:var(--c-fg-muted)]",
      )}
    >
      {dq}
    </span>
  );
}
