/**
 * Internal Zod schemas mirroring the public `MatchedSkill` / `IntentSource`
 * type contracts (declared in `@flow-state-dev/core/types/skill`).
 *
 * Co-located here so every block in the intentSelector pipeline references
 * a single source of truth for the runtime shape — the cross-tier sequencer
 * state and the classifier `outputSchema` both read from these.
 *
 * Intent classification in this package is **skill-only** — what skill (if
 * any) does this turn need? Other classification dimensions (e.g. the
 * kitchen-sink thinking-style auto-router) live in their own pipelines and
 * compose alongside intentSelector if a flow wants both.
 */

import { z } from "zod";

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

/**
 * Sequencer-state fragment used to coordinate the three tiers. Each tier
 * accumulates its findings into this fragment; the apply-intent handler
 * reads the accumulated state at the end of the pipeline.
 *
 * `resolved` gates tier-3 (the LLM classifier) — a tier sets it to `true`
 * once the skill dimension has been answered. Top-level `intentSource` is
 * derived in apply-intent from the first matched skill's per-entry source
 * (uniform per tier), so we don't carry it as a separate field here.
 */
export const intentSequencerStateSchema = z.object({
  resolved: z.boolean().default(false),
  /** Accumulated skill matches across tiers. */
  skills: z.array(matchedSkillSchema).default([]),
  /** Classifier-tier aggregate confidence, when classifier ran. */
  classifierConfidence: z.number().min(0).max(1).nullable().default(null),
});
