/**
 * lens-card — dedicated doc renderer for ONE investor-lens memo (Slice 7).
 *
 * Slice 5 already produced the lens data: each of the four documented-methodology
 * lenses (`qualityValueLens` / `cycleRiskLens` / `macroReflexiveLens` /
 * `forensicSkepticLens`) commits a `memos/p2b/<lensId>` memo carrying
 * `label` / `headline` (the verdict sentence) / `rating` (stance label) /
 * `stance` / `conviction` and a synthesized `body` (Verdict, Key driver, an
 * optional "What would flip this", and a "Data gaps (honesty)" section listing
 * `missingData`). This component is a PURE PRESENTATIONAL consumer of that memo
 * — it adds NO transport, NO fetch, NO schema, and no math. The generic
 * `ThesisHeader + ThesisBody` fall-through under-served lenses (no
 * attribution/glyph framing, no data-gap honesty line, no structural-bear
 * affordance); the LensCard is the delta over Slice 5's generic render.
 *
 * Identity is sourced READ-ONLY from the committed Slice-5 artifacts:
 *   - glyph + accent hue from the lens's `AGENTS` entry (via `AgentBadge`),
 *   - human label + `attribution` ("applying X's documented methodology") from
 *     `LENS_PACK` in `lib/lenses.ts`,
 *   - lensId from the agent ↔ lensId mapping derived off `PHASE_2B_MEMO_KEYS`.
 *
 * Real-money framing (BUILD_PLAN §1.7, spec 07 §13): attribution reads
 * "applying {attribution}", never "what X thinks today"; a `missingData` /
 * `dataGap` is surfaced as a ⚠ honesty line, never hidden; the card carries the
 * not-advice line. The forensic-skeptic is the pack's STRUCTURAL bear — it
 * dissents by design — so its card is labelled as such (derived INLINE from
 * `lensId === "forensic-skeptic"`) so a lone forensic dissent reads as expected,
 * not as alarming divergence. This is UI labelling ONLY; the deterministic
 * convergence handler + its math (Slice 5, FIX-655) are untouched.
 */
import type { ReactElement } from "react";
import { AgentBadge } from "@/components/agent-badge";
import {
  LENS_IDS,
  PHASE_2B_MEMO_KEYS,
  type AgentName,
  type LensId,
} from "@/src/flows/analysis/registry";
import { LENS_PACK } from "@/src/flows/analysis/agents/lenses/lenses";
import { LENS_BODY_SECTION } from "@/src/flows/analysis/agents/lenses/lens-body-sections";
import type { ThesisSection } from "@/src/flows/analysis/resources";
import { cn } from "@/lib/utils";

/** The lensId whose lens is the pack's permanent structural bear (Burry —
 *  spec 07 §15.5). Derived INLINE here, not from a schema flag: the structural
 *  role is a UI labelling concern, not a stored field. A lone dissent from this
 *  lens is EXPECTED (it dissents by design), so the card flags it so the reader
 *  doesn't misread one bear as alarming divergence. */
const STRUCTURAL_BEAR_LENS_ID: LensId = "forensic-skeptic";

/** Agent → lensId, derived from the Slice-5 `PHASE_2B_MEMO_KEYS` registry
 *  (read-only). Lens memos are keyed by lensId; the four lens agents back the
 *  sidebar badge/color. Building this here (rather than importing a mapping)
 *  keeps the card a pure consumer and avoids editing `agents.ts`. */
const LENS_ID_BY_AGENT: Partial<Record<AgentName, LensId>> = Object.fromEntries(
  LENS_IDS.map((id) => [PHASE_2B_MEMO_KEYS[id].agentName, id]),
);

/** The minimal Slice-5 memo fields the LensCard reads. A subset of the
 *  `MemoClientData` the dispatcher already projects off `MemoState`; declared
 *  structurally so the card stays decoupled from the full client-data type. */
export type LensMemoData = {
  label: string | null;
  /** The lens's one-sentence verdict (stored on the memo's `headline`). */
  headline: string | null;
  /** The stance label chip (stored on the memo's `rating`). */
  rating: string | null;
  stance: "bullish" | "neutral" | "bearish" | null;
  conviction: number | null;
  body: ReadonlyArray<ThesisSection> | null;
};

/** The render-ready view-model the card draws. Pure-derivable from
 *  `(agent, data)` so the load-bearing mapping (attribution framing, data-gap
 *  honesty, structural-bear flag) is unit-testable without rendering JSX (the
 *  test env is node + `.spec.ts`, matching `aggregate.ts`'s `stanceToAxis`). */
export type LensCardModel = {
  lensId: LensId | null;
  label: string;
  /** Raw attribution from the pack, e.g. "Buffett / Munger documented
   *  methodology". The card frames it as "applying {attribution}". */
  attribution: string;
  stance: "bullish" | "neutral" | "bearish" | null;
  conviction: number | null;
  verdict: string;
  keyDriver: string;
  /** The data-gap honesty line — a `dataGap` sentence and/or the `missingData`
   *  list recovered from the synthesized body. Empty when the bundle sufficed. */
  dataGap: string;
  missingData: ReadonlyArray<string>;
  /** True only for the forensic-skeptic lens — the pack's structural bear. */
  isStructuralBear: boolean;
};

/**
 * Derive the LensCard view-model from the agent identity + its memo data.
 * Pure (no React, no IO) so the attribution framing, data-gap recovery, and
 * structural-bear flagging are testable in isolation. Resolves the lensId from
 * the agent, then reads the pack's `label`/`attribution` and recovers the
 * key-driver + data-gap honesty fields from the synthesized body sections the
 * Slice-5 writer produced ("Key driver", "Data gaps (honesty)").
 */
export function buildLensCardModel(
  agent: AgentName,
  data: LensMemoData | null,
): LensCardModel {
  const lensId = LENS_ID_BY_AGENT[agent] ?? null;
  const lens = lensId !== null ? LENS_PACK.find((l) => l.id === lensId) : undefined;
  const body = data?.body ?? [];
  const keyDriver = body.find((s) => s.h === LENS_BODY_SECTION.keyDriver)?.p ?? "";
  const gapSection = body.find((s) => s.h === LENS_BODY_SECTION.dataGaps);
  return {
    lensId,
    label: data?.label ?? lens?.label ?? (lensId ?? agent),
    attribution: lens?.attribution ?? "",
    stance: data?.stance ?? null,
    conviction: data?.conviction ?? null,
    verdict: data?.headline ?? "",
    keyDriver,
    dataGap: gapSection?.p ?? "",
    missingData: gapSection?.items ?? [],
    isStructuralBear: lensId === STRUCTURAL_BEAR_LENS_ID,
  };
}

/** Stance → accent color, matching the PmHero convergence-strip idiom so the
 *  per-lens stance reads consistently across the lens surfaces. */
function stanceColor(stance: "bullish" | "neutral" | "bearish"): string {
  if (stance === "bullish") return "var(--c-live)";
  if (stance === "bearish") return "var(--c-warn)";
  return "var(--c-fg-muted)";
}

export type LensCardProps = {
  agent: AgentName;
  data: LensMemoData | null;
};

/**
 * Render one lens memo as a dedicated card: glyph + label + the
 * "applying {attribution}" framing, the structural-bear affordance (forensic
 * skeptic only), stance + conviction, the verdict sentence, the key driver, and
 * a ⚠ data-gap honesty line. Documented-methodology / not-advice framing is
 * preserved on the card footer.
 */
export function LensCard({ agent, data }: LensCardProps): ReactElement {
  const model = buildLensCardModel(agent, data);
  return (
    <article
      className={cn(
        "flex flex-col gap-4 rounded-lg border p-5",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Investor lens verdict"
    >
      <header className="flex items-start gap-3">
        <AgentBadge agent={agent} treatment="loud" />
        <div className="flex flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-[color:var(--c-fg)]">
              {model.label}
            </span>
            {model.isStructuralBear ? (
              <span
                className={cn(
                  "rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider",
                  "border-[color:var(--c-warn)]/50 text-[color:var(--c-warn)]",
                )}
                title="This lens is the pack's structural bear — it dissents by design, so a lone bearish read here is expected, not alarming divergence."
              >
                structural bear · dissents by design
              </span>
            ) : null}
          </div>
          {model.attribution !== "" ? (
            <span className="text-[11px] text-[color:var(--c-fg-muted)]">
              applying {model.attribution}
            </span>
          ) : null}
        </div>
      </header>

      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border p-2.5",
          "border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]",
        )}
        aria-label="Lens verdict"
      >
        <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          verdict
        </span>
        {model.stance !== null ? (
          <span className="flex items-center gap-1.5 text-[12.5px] text-[color:var(--c-fg)]">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: stanceColor(model.stance) }}
              aria-hidden
            />
            <span className="capitalize">{model.stance}</span>
          </span>
        ) : (
          <span className="text-[12.5px] text-[color:var(--c-fg-muted)]">—</span>
        )}
        {model.conviction !== null ? (
          <span className="text-[11.5px] text-[color:var(--c-fg-muted)]">
            <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              conviction
            </span>{" "}
            {model.conviction.toFixed(2)}
          </span>
        ) : null}
      </div>

      {model.verdict !== "" ? (
        <p className="text-[14px] leading-snug text-[color:var(--c-fg)]">
          {model.verdict}
        </p>
      ) : null}

      {model.keyDriver !== "" ? (
        <p className="text-[12.5px] text-[color:var(--c-fg)]">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            key driver
          </span>{" "}
          {model.keyDriver}
        </p>
      ) : null}

      {model.dataGap !== "" || model.missingData.length > 0 ? (
        <p className="flex flex-col gap-0.5 text-[11.5px] leading-snug text-[color:var(--c-warn)]">
          <span>
            <span aria-hidden>⚠ </span>
            {model.dataGap !== ""
              ? model.dataGap
              : "This lens flagged a data gap (BP-020 honesty)."}
          </span>
          {model.missingData.length > 0 ? (
            <span className="text-[color:var(--c-fg-muted)]">
              missing: {model.missingData.join(", ")}
            </span>
          ) : null}
        </p>
      ) : null}

      <p className="text-[10px] leading-snug text-[color:var(--c-fg-faint)]">
        Independent verdict (not a debate). Applying this investor's documented
        methodology to the same evidence — not a claim about what they think
        today, and not financial advice.
      </p>
    </article>
  );
}
