/**
 * `createSkillActivator` — the public factory for FIX-421's up-front
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
import type { ExplicitActivationScope } from "./activation-store";
import { createApplySkillActivation } from "./apply-skill-activation";
import {
  createSkillClassifierSequencer,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_MAX_SKILLS,
} from "./skill-classifier-gen";
import { createSkillKeywordMatch } from "./skill-keyword-match";
import { createSkillSlashMatch } from "./skill-slash-match";
import { skillActivatorStateSchema } from "./skill-activation-types";

const activatorInputSchema = z.object({ message: z.string() }).passthrough();

export interface SkillActivatorOptions {
  /** Block name. Default `"skill-activator"`. */
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
   * When `false`, skillActivator skips tier 3 entirely (no LLM call). The
   * apply handler runs against whatever tiers 1–2 produced. Default `true`.
   * Set `false` in tests that should not rely on a mocked classifier and in
   * deployments that want only deterministic tiers.
   */
  enableLlmClassifier?: boolean;
  /**
   * Where the matcher writes its resolved activations. Default
   * `{ scope: "session", field: "activeSkills" }`. To feed a Skills v2
   * per-generator binding, point this at that binding's explicit
   * `activeState` field (a matcher runs before the generator, so it cannot
   * reach a downstream generator's block-state default — it needs an explicit
   * shared field).
   */
  activeState?: { scope: ExplicitActivationScope; field: string };
  /**
   * Restrict matches to the target binding's `allowed` set. Without it, a
   * `/skill` or keyword hit for any skill in the collection would land in the
   * shared field and render on a generator that was never given that skill.
   */
  allowed?: readonly string[];
}

/**
 * Build the up-front skill activator sequencer.
 *
 * Returns a `.tap`-able block — it returns its input unchanged so it can
 * be chained ahead of downstream consumers without input-shape coupling.
 */
export function createSkillActivator(
  options: SkillActivatorOptions = {},
): BlockDefinition<typeof activatorInputSchema, typeof activatorInputSchema> {
  const collectionKey = options.collectionKey ?? "skills";
  const enableLlm = options.enableLlmClassifier ?? true;

  const slashTier = createSkillSlashMatch({ collectionKey });
  const keywordTier = createSkillKeywordMatch({ collectionKey });
  const apply = createApplySkillActivation({
    collectionKey,
    ...(options.activeState ? { activeState: options.activeState } : {}),
    ...(options.allowed ? { allowed: options.allowed } : {}),
  });

  let pipeline = sequencer({
    name: options.name ?? "skill-activator",
    inputSchema: activatorInputSchema,
    stateSchema: skillActivatorStateSchema,
  })
    .tap(slashTier)
    .tapIf((_input, ctx) => !ctx.sequencer?.state.resolved, keywordTier);

  if (enableLlm) {
    const classifier = createSkillClassifierSequencer({
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
    typeof activatorInputSchema,
    typeof activatorInputSchema
  >;
}
