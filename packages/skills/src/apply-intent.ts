/**
 * Final step of intentSelector — collapses the cross-tier sequencer state
 * into an `IntentResult` and writes it to both request and session state.
 *
 * Write order is intentional and load-bearing — see FIX-421 spec §3.3:
 *
 *   1. `ctx.request.patchState({ intent })` — transient per-turn record.
 *      Safe to write first; no downstream reader depends on it.
 *   2. `ctx.session.patchState({ activeSkills, __activeSkills })` — the
 *      persistent surface read by the active-skills context formatter and
 *      the kitchen-sink `clientData` projection.
 *
 * Cross-scope atomicity is not a primitive in `ScopeStateOps`. If write 1
 * succeeds and write 2 fails, the request state carries the decision but
 * session state lags. Recoverable on the next turn.
 *
 * `__activeSkills` is **replaced** (not appended) here — divergence from
 * `pushActiveSkill`'s append-with-dedup semantics. The up-front path
 * decides per-turn; we don't accumulate prior turns' activations into the
 * current turn's surface. Mid-flow `runSkill` calls within the same turn
 * still append on top via the existing `pushActiveSkill` path.
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import { activeSkillStateSchema } from "./active-skill-state";
import {
  intentRequestStateSchema,
  intentSequencerStateSchema,
  intentSessionStateSchema,
} from "./intent-types";

const inputSchema = z.object({ message: z.string() }).passthrough();
const outputSchema = z.object({
  skillCount: z.number(),
  intentSource: z.string(),
});

// Combined session schema so the handler can patch both `__activeSkills`
// (declared by activeSkillStateSchema) and `activeSkills` (declared by
// intentSessionStateSchema) under a single typed surface.
const combinedSessionStateSchema = z
  .object({})
  .merge(activeSkillStateSchema)
  .merge(intentSessionStateSchema);

/** Build the apply-intent handler. */
export function createApplyIntent() {
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
      // Each tier produces uniformly-sourced matches, so the top-level
      // intent source is whichever tier produced the first skill match.
      // No matches → classifier was the last tier to run.
      const intentSource = skills[0]?.source ?? "classifier";

      const intent = {
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
      await ctx.session.patchState({
        __activeSkills: activeSkillEntries,
        activeSkills: skills,
      });

      return { skillCount: skills.length, intentSource };
    },
  });
}
