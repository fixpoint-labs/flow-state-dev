/**
 * Internal Zod schemas mirroring the public `MatchedSkill` /
 * `SkillActivationSource` type contracts (declared in
 * `@flow-state-dev/core/types/skill`).
 *
 * Co-located here so every block in the skillActivator pipeline references
 * a single source of truth for the runtime shape — the cross-tier sequencer
 * state and the classifier `outputSchema` both read from these.
 *
 * Skill activation in this package is **skill-only** — what skill (if
 * any) does this turn need? Other classification dimensions (e.g. the
 * kitchen-sink thinking-style auto-router) live in their own pipelines and
 * compose alongside skillActivator if a flow wants both.
 */

import { z } from "zod";

/** Origin of a skill-activation match — mirrors `SkillActivationSource` in core. */
export const skillActivationSourceSchema = z.enum([
  "slash",
  "keyword",
  "classifier",
  "manual-override",
]);

/** Runtime shape of `MatchedSkill` (core type). */
export const matchedSkillSchema = z.object({
  name: z.string(),
  input: z.string().default(""),
  source: skillActivationSourceSchema,
  confidence: z.number().min(0).max(1).optional(),
});

/**
 * Sequencer-state fragment used to coordinate the three tiers. Each tier
 * accumulates its findings into this fragment; the apply-skill-activation
 * handler reads the accumulated state at the end of the pipeline.
 *
 * `resolved` gates tier-3 (the LLM classifier) — a tier sets it to `true`
 * once the skill dimension has been answered. Top-level `activationSource`
 * is derived in apply-skill-activation from the first matched skill's
 * per-entry source (uniform per tier), so we don't carry it as a separate
 * field here.
 */
export const skillActivatorStateSchema = z.object({
  resolved: z.boolean().default(false),
  /** Accumulated skill matches across tiers. */
  skills: z.array(matchedSkillSchema).default([]),
  /** Classifier-tier aggregate confidence, when classifier ran. */
  classifierConfidence: z.number().min(0).max(1).nullable().default(null),
});
