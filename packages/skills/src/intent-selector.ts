/**
 * `createIntentSelector` — the public factory for FIX-421's up-front
 * skill-activation router.
 *
 * Composes a three-tier sequencer that decides which skills (if any) apply
 * to a user message before the main generator runs:
 *
 *   1. Slash matcher  — literal `/<skill-name>` prefix, no LLM call.
 *   2. Keyword scan   — local heuristics on per-skill `keywords` frontmatter.
 *   3. LLM classifier — a structured-output generator call, runs only when
 *                       earlier tiers were inconclusive.
 *
 * After the tiers, an apply handler writes the matched skills to
 * `session.state.activeSkills` — the same slot the active-skill body
 * formatter reads on every generator step.
 *
 * The returned block is a `.tap()`-able sequencer — it patches state and
 * returns its input unchanged, so a flow can insert it anywhere in an
 * existing chain without disturbing downstream input shapes.
 *
 * Scope: skill activation only. Other classification dimensions (e.g. the
 * kitchen-sink thinking-style auto-router) live in their own pipelines and
 * compose alongside this one if a flow wants both.
 *
 * Tier-3 LLM classification is opt-out via `enableLlmClassifier: false` —
 * useful in tests and in deployments that only want deterministic tiers.
 */

import { z } from "zod";
import { sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { createApplyIntent } from "./apply-intent";
import {
  createIntentClassifierSequencer,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_MAX_SKILLS,
} from "./intent-classifier-gen";
import { createIntentKeywordMatch } from "./intent-keyword-match";
import { createIntentSlashMatch } from "./intent-slash-match";
import { intentSequencerStateSchema } from "./intent-types";

const intentInputSchema = z.object({ message: z.string() }).passthrough();

export interface IntentSelectorOptions {
  /** Block name. Default `"intent-selector"`. */
  name?: string;
  /** Resource registry key for the skills collection. Default `"skills"`. */
  collectionKey?: string;
  /** Model the tier-3 classifier uses. Default `"intent/utility"`. */
  classifierModel?: string;
  /** Confidence threshold for accepting a classifier match. Default 0.65. */
  confidenceThreshold?: number;
  /** Cap on skills described in the classifier prompt. Default 20. */
  maxSkillsInClassifier?: number;
  /**
   * When `false`, intentSelector skips tier 3 entirely (no LLM call). The
   * apply handler runs against whatever tiers 1–2 produced. Default `true`.
   * Set `false` in tests that should not rely on a mocked classifier and in
   * deployments that want only deterministic tiers.
   */
  enableLlmClassifier?: boolean;
}

/**
 * Build the up-front skill intent selector sequencer.
 *
 * Returns a `.tap`-able block — it returns its input unchanged so it can
 * be chained ahead of downstream consumers without input-shape coupling.
 */
export function createIntentSelector(
  options: IntentSelectorOptions = {},
): BlockDefinition<typeof intentInputSchema, typeof intentInputSchema> {
  const collectionKey = options.collectionKey ?? "skills";
  const enableLlm = options.enableLlmClassifier ?? true;

  const slashTier = createIntentSlashMatch({ collectionKey });
  const keywordTier = createIntentKeywordMatch({ collectionKey });
  const apply = createApplyIntent();

  let pipeline = sequencer({
    name: options.name ?? "intent-selector",
    inputSchema: intentInputSchema,
    stateSchema: intentSequencerStateSchema,
  })
    .tap(slashTier)
    .tapIf((_input, ctx) => !ctx.sequencer?.state.resolved, keywordTier);

  if (enableLlm) {
    const classifier = createIntentClassifierSequencer({
      collectionKey,
      classifierModel: options.classifierModel,
      confidenceThreshold:
        options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
      maxSkillsInClassifier:
        options.maxSkillsInClassifier ?? DEFAULT_MAX_SKILLS,
    });
    pipeline = pipeline.tapIf(
      (_input, ctx) => !ctx.sequencer?.state.resolved,
      classifier,
    );
  }

  return pipeline.tap(apply) as unknown as BlockDefinition<
    typeof intentInputSchema,
    typeof intentInputSchema
  >;
}
