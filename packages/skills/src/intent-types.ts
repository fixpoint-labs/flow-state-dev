/**
 * Internal Zod schemas mirroring the public `MatchedSkill` / `IntentResult`
 * type contracts (declared in `@flow-state-dev/core/types/skill`).
 *
 * Co-located here so every block in the intentSelector pipeline references
 * a single source of truth for the runtime shape — the cross-tier sequencer
 * state, the classifier `outputSchema`, and the request-state schema all
 * read from these.
 */

import { z } from "zod";
import { thinkingStyleSchema } from "@flow-state-dev/core/types";

/** Origin of an intent-selection match — mirrors `IntentSource` in core. */
export const intentSourceSchema = z.enum([
  "slash",
  "keyword",
  "classifier",
  "manual-override",
]);

/** Runtime shape of `MatchedSkill` (core type). */
export const matchedSkillSchema = z.object({
  name: z.string(),
  input: z.string().default(""),
  source: intentSourceSchema,
  confidence: z.number().min(0).max(1).optional(),
});

/** Runtime shape of `IntentResult` (core type). */
export const intentResultSchema = z.object({
  thinkingStyle: thinkingStyleSchema,
  activeSkills: z.array(matchedSkillSchema),
  intentSource: intentSourceSchema,
  classifierConfidence: z.number().min(0).max(1).optional(),
});

/**
 * Request-state fragment the apply-intent handler writes. Used to type
 * `ctx.request.patchState({ intent })` calls and to give downstream blocks
 * (trace UI, pattern dispatch) a typed read surface via
 * `requestStateSchema: intentRequestStateSchema`.
 */
export const intentRequestStateSchema = z.object({
  intent: intentResultSchema.optional(),
});

/**
 * Session-state fragment intent results are projected into. This is a
 * superset of the existing `__activeSkills` schema — `thinkingStyle` is
 * the resolved style read by the kitchen-sink `thinkingStyleRouter`, and
 * `activeSkills` is the surface-level mirror used by client-data
 * projections so the trace UI doesn't have to read the internal slot.
 */
export const intentSessionStateSchema = z.object({
  thinkingStyle: thinkingStyleSchema.optional(),
  activeSkills: z.array(matchedSkillSchema).optional(),
});

/**
 * Sequencer-state fragment used to coordinate the three tiers. Each tier
 * accumulates its findings into this fragment; the apply-intent handler
 * reads the accumulated state at the end of the pipeline.
 *
 * `resolved` gates tier-3 (the LLM classifier) — a tier sets it to `true`
 * once both dimensions (thinking style + skill match) have been covered.
 * Tier 1 (slash) sets `resolved` immediately because the user opted out
 * of further classification by typing the explicit skill prefix.
 */
export const intentSequencerStateSchema = z.object({
  resolved: z.boolean().default(false),
  /** Resolved thinking style (any tier). `null` means "no tier produced one". */
  thinkingStyle: thinkingStyleSchema.nullable().default(null),
  /** Origin of the resolved style. Apply-intent prefers this over the per-tier default. */
  thinkingStyleSource: intentSourceSchema.nullable().default(null),
  /** Accumulated skill matches across tiers. */
  skills: z.array(matchedSkillSchema).default([]),
  /** Classifier-tier aggregate confidence, when classifier ran. */
  classifierConfidence: z.number().min(0).max(1).nullable().default(null),
});
