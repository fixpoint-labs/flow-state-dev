/**
 * Phase-2b lens-pack memo-writing blocks + the deterministic convergence tap.
 *
 *   - `markWritingP2b` / `markErrorP2b` — built via `defineMemoStateBlocks`
 *     (identity-only parameterization), over the lens-pack memo registry.
 *   - `commitLensVerdict(lensId)` — a per-lens commit factory (BP-024). Projects
 *     the strict `lensVerdictOutputSchema` onto memo state, validates the echoed
 *     `lensId`, stamps `label`/`attribution`/`stance` (from the pack, NOT the
 *     LLM — the `agreesWithTrader` precedent), and synthesizes a small `body`
 *     so the generic memo renderer has something to show (the verdict schema has
 *     no `body` field, by design — kept minimal + strict).
 *   - `computeAndStoreConvergence` — a `.tap` handler (BP-012, no output, no
 *     `return input`). Reads the N committed lens memos, builds the
 *     `lensConvergenceState` via the deterministic `computeConvergence` math
 *     (NO LLM — the FIX-655 honesty guarantee), and writes it to
 *     `lensConvergenceResource` via `patchState` (single-resource write verb).
 *     This block is the single source of the convergence number.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { LENS_IDS, PHASE_2B_MEMO_KEYS, type LensId } from "../agents";
import { LENS_PACK } from "../lib/lenses";
import { computeConvergence } from "../lib/convergence-math";
import {
  lensConvergenceResource,
  type LensVerdictRecord,
} from "../lens-convergence-resource";
import {
  defineMemoStateBlocks,
  memoHandler,
  publishMemo,
} from "../lib/memo-writer";
import { memoResources, type ThesisSection } from "../resources";
import { sessionStateSchema } from "../state";
import { lensVerdictOutputSchema } from "./lens-verdict-schema";
import { LENS_BODY_SECTION } from "./lens-body-sections";

export const {
  markWriting: markWritingP2b,
  markError: markErrorP2b,
} = defineMemoStateBlocks({
  phaseId: "p2b",
  agentTeam: "research",
  keys: PHASE_2B_MEMO_KEYS,
  errorMessageFallback: "Lens verdict failed.",
});

/** Map a 3-tier stance to the free-form `rating` header chip + a colorable label. */
function stanceLabel(stance: "bullish" | "neutral" | "bearish"): string {
  if (stance === "bullish") return "Bullish";
  if (stance === "bearish") return "Bearish";
  return "Neutral";
}

/** Synthesize a 2–3 section memo body from the strict verdict so the generic
 *  renderer (ThesisHeader + ThesisBody) shows the lens's reasoning. The verdict
 *  schema carries no `body` field by design — kept minimal + strict. */
function lensBody(verdict: {
  verdict: string;
  keyDriver: string;
  disqualifierHit: string;
  dataGap: string;
  missingData: string[];
}): ThesisSection[] {
  const sections: ThesisSection[] = [
    { h: LENS_BODY_SECTION.verdict, p: verdict.verdict, items: null },
    { h: LENS_BODY_SECTION.keyDriver, p: verdict.keyDriver, items: null },
  ];
  if (verdict.disqualifierHit !== "") {
    sections.push({ h: LENS_BODY_SECTION.disqualifier, p: verdict.disqualifierHit, items: null });
  }
  if (verdict.dataGap !== "" || verdict.missingData.length > 0) {
    sections.push({
      h: LENS_BODY_SECTION.dataGaps,
      p: verdict.dataGap !== "" ? verdict.dataGap : null,
      items: verdict.missingData.length > 0 ? verdict.missingData : null,
    });
  }
  return sections;
}

/**
 * Build the commit handler for one lens. Validates the echoed `lensId`, then
 * publishes the memo with the pack-derived identity fields and a synthesized
 * body. The display `rating`/`headline`/`label` come from the pack + the stance,
 * not the LLM, so the renderer is consistent across lenses.
 */
export function commitLensVerdict(lensId: LensId) {
  const { collectionKey } = PHASE_2B_MEMO_KEYS[lensId];
  const lens = LENS_PACK.find((l) => l.id === lensId);
  return memoHandler({
    name: `commit-memo-p2b-${lensId}`,
    inputSchema: lensVerdictOutputSchema,
    execute: async (verdict, ctx) => {
      // Defensive: the generator echoes its lensId; a mismatch means a mis-wired
      // factory instance. We trust the pack identity over the echo regardless,
      // but a mismatch is worth surfacing into the rescue.
      if (verdict.lensId !== lensId) {
        throw new Error(
          `lens-id-mismatch: generator answered for "${verdict.lensId}", expected "${lensId}"`,
        );
      }
      await publishMemo(ctx, lensId, collectionKey, {
        label: lens?.label ?? lensId,
        headline: verdict.verdict,
        rating: stanceLabel(verdict.stance),
        body: lensBody(verdict),
        // 3-tier stance reuses the existing memo `stance` field; the convergence
        // tap reads it back. `conviction` reuses the existing nullable field.
        stance: verdict.stance,
        conviction: verdict.conviction,
      });
    },
  });
}

/**
 * Deterministic convergence tap. Reads each committed lens memo, builds a
 * verdict record per published lens (errored lenses are skipped — they did not
 * produce a verdict), computes the convergence summary, and writes it to the
 * `lensConvergence` resource. Equal-weight by conviction in v1 (open-Q#3): a
 * lens that flagged a `dataGap` is surfaced, not down-weighted.
 *
 * Single-resource write verb is `patchState` (there is no `.set()` on a single
 * resource); the first patch on the defaultless-nullable resource initializes it.
 */
export const computeAndStoreConvergence = handler({
  name: "compute-and-store-lens-convergence",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: {
    ...memoResources,
    lensConvergence: lensConvergenceResource,
  },
  execute: async (_input, ctx) => {
    const records: LensVerdictRecord[] = [];
    for (const id of LENS_IDS) {
      const { collectionKey } = PHASE_2B_MEMO_KEYS[id];
      const ref = await ctx.resources.memos.getOptional(collectionKey);
      const state = ref?.state as
        | {
            status?: string;
            headline?: string | null;
            stance?: "bullish" | "neutral" | "bearish" | null;
            conviction?: number | null;
            body?: ThesisSection[] | null;
          }
        | undefined;
      // Only published lenses with a recorded stance count toward convergence.
      if (
        state?.status !== "published" ||
        state.stance == null ||
        state.conviction == null
      ) {
        continue;
      }
      const lens = LENS_PACK.find((l) => l.id === id);
      // Recover keyDriver / dataGap / missingData from the synthesized body so the
      // mirror is self-contained for the UI without a second source.
      const body = state.body ?? [];
      const keyDriver = body.find((s) => s.h === LENS_BODY_SECTION.keyDriver)?.p ?? "";
      const gapSection = body.find((s) => s.h === LENS_BODY_SECTION.dataGaps);
      records.push({
        lensId: id,
        label: lens?.label ?? id,
        attribution: lens?.attribution ?? "",
        glyph: lens?.glyph ?? "",
        stance: state.stance,
        conviction: state.conviction,
        verdict: state.headline ?? "",
        keyDriver,
        dataGap: gapSection?.p ?? "",
        missingData: gapSection?.items ?? [],
      });
    }

    const convergence = computeConvergence(records);
    await ctx.resources.lensConvergence.patchState(convergence);
  },
});

/**
 * Defensive reset of the session-scoped `lensConvergence` resource, run on every
 * analysis (OUTSIDE the cost gate) before the lens pack. Today a session's
 * `costPreset` is fixed — it is part of the keying tuple — so a `full` session
 * always recomputes convergence and a `fast` session never wrote it; the stale
 * path is not reachable. This clear makes the "no stale convergence across
 * re-runs" invariant explicit and robust if the tuple ever changes (e.g. if a
 * session could be re-run at a different preset). On `full` the pack overwrites
 * it via `computeAndStoreConvergence`; on `fast` it stays null. `.tap` (BP-012):
 * mutation-only, no output, no `return input`.
 */
export const resetLensConvergence = handler({
  name: "reset-lens-convergence",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  resources: { lensConvergence: lensConvergenceResource },
  execute: async (_input, ctx) => {
    await ctx.resources.lensConvergence.setState(null);
  },
});
