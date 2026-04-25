/**
 * Final step of intentSelector — collapses the cross-tier sequencer state
 * into an `IntentResult` and writes it to both request and session state.
 *
 * Write order is intentional and load-bearing — see FIX-421 spec §3.3:
 *
 *   1. `ctx.request.patchState({ intent })` — transient per-turn record.
 *      Safe to write first; no downstream reader depends on it.
 *   2. `ctx.session.patchState({ thinkingStyle, activeSkills, __activeSkills })`
 *      — the persistent surface read by the active-skills context formatter,
 *      the kitchen-sink `thinkingStyleRouter`, and `clientData` projections.
 *
 * Cross-scope atomicity is not a primitive in `ScopeStateOps` (see
 * `packages/core/src/types/state.ts`). If write 1 succeeds and write 2
 * fails, the request state carries the decision but session state lags.
 * Recoverable on the next turn.
 *
 * `__activeSkills` is **replaced** (not appended) here — divergence from
 * `pushActiveSkill`'s append-with-dedup semantics. The up-front path
 * decides per-turn; we don't accumulate prior turns' activations into the
 * current turn's surface. Mid-flow `runSkill` calls within the same turn
 * still append on top via the existing `pushActiveSkill` path.
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type { ThinkingStyle } from "@flow-state-dev/core/types";
import { activeSkillStateSchema } from "./active-skill-state";
import {
  intentRequestStateSchema,
  intentSequencerStateSchema,
  intentSessionStateSchema,
} from "./intent-types";

const inputSchema = z.object({ message: z.string() }).passthrough();
const outputSchema = z.object({
  thinkingStyle: z.string(),
  skillCount: z.number(),
});

// Combined session schema so the handler can patch both `__activeSkills`
// (declared by activeSkillStateSchema) and `thinkingStyle`/`activeSkills`
// (declared by intentSessionStateSchema) under a single typed surface.
const combinedSessionStateSchema = z
  .object({})
  .merge(activeSkillStateSchema)
  .merge(intentSessionStateSchema);

export interface ApplyIntentOptions {
  /**
   * If `true`, intentSelector resolves the thinking style for the turn and
   * overwrites `session.state.thinkingStyle`. If `false`, leaves
   * `thinkingStyle` untouched in session state — used when the turn carries
   * a manual UI override and we want to skip auto-resolution entirely.
   *
   * Default `true`.
   */
  resolveThinkingStyle?: boolean;
}

/**
 * Build the apply-intent handler. Reads cross-tier sequencer state, packs
 * an `IntentResult`, writes to request state then session state.
 */
export function createApplyIntent(opts: ApplyIntentOptions = {}) {
  const resolveThinkingStyle = opts.resolveThinkingStyle ?? true;

  return handler({
    name: "apply-intent",
    inputSchema,
    outputSchema,
    sequencerStateSchema: intentSequencerStateSchema,
    requestStateSchema: intentRequestStateSchema,
    sessionStateSchema: combinedSessionStateSchema,
    execute: async (_input, ctx) => {
      const seq = ctx.sequencer?.state;
      const skills = seq?.skills ?? [];
      const resolvedStyle: ThinkingStyle = seq?.thinkingStyle ?? "default";
      const styleSource = seq?.thinkingStyleSource ?? "classifier";

      // Choose top-level `intentSource`: prefer the slash tier when any
      // slash-sourced skill matched, otherwise the style's source.
      const slashSkill = skills.find((s) => s.source === "slash");
      const intentSource = slashSkill ? "slash" : styleSource;

      const intent = {
        thinkingStyle: resolvedStyle,
        activeSkills: skills,
        intentSource,
        ...(seq?.classifierConfidence !== null &&
        seq?.classifierConfidence !== undefined
          ? { classifierConfidence: seq.classifierConfidence }
          : {}),
      };

      // Write 1 — request state. Safe to write first; no reader depends on it.
      await ctx.request.patchState({ intent });

      // Write 2 — session state. Replaces __activeSkills with this turn's
      // matches in inline mode (the up-front path always activates inline).
      const activeSkillEntries = skills.map((s) => ({
        name: s.name,
        mode: "inline" as const,
        input: s.input,
        activatedAt: Date.now(),
      }));
      const sessionPatch: Record<string, unknown> = {
        __activeSkills: activeSkillEntries,
        activeSkills: skills,
      };
      if (resolveThinkingStyle) {
        sessionPatch.thinkingStyle = resolvedStyle;
      }
      await ctx.session.patchState(sessionPatch);

      return { thinkingStyle: resolvedStyle, skillCount: skills.length };
    },
  });
}
