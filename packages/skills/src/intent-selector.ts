/**
 * `createIntentSelector` — the public factory for FIX-421's up-front intent
 * routing pipeline.
 *
 * Composes a three-tier sequencer:
 *   1. Slash matcher  — literal `/<skill-name>` prefix, no LLM call.
 *   2. Keyword scan   — local heuristics on thinking-style + skill keywords.
 *   3. LLM classifier — multi-dim generator call, fills whatever tiers 1–2
 *                       left unresolved.
 *
 * After the tiers, an apply handler collapses the accumulated cross-tier
 * state into an `IntentResult` and writes it to both request and session
 * state in canonical order (request first, session second — see
 * `apply-intent.ts` and FIX-421 spec §3.3).
 *
 * The returned block is a `.tap()`-able sequencer — it patches state and
 * returns its input unchanged, so it can be inserted into a flow's existing
 * `.tap(applyRequestedMode).tap(...).tap(intentSelector)` chain without
 * disturbing downstream input shapes.
 *
 * Tier-3 LLM classification is opt-out via `enableLlmClassifier: false` —
 * useful in tests and in flows that only want the deterministic tiers.
 */

import { z } from "zod";
import { sequencer } from "@flow-state-dev/core";
import type { BlockDefinition, ScopeType } from "@flow-state-dev/core/types";
import { createApplyIntent } from "./apply-intent";
import {
  createIntentClassifierSequencer,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_MAX_SKILLS,
  type IntentClassifierOptions,
} from "./intent-classifier-gen";
import {
  createIntentKeywordMatch,
  type ThinkingStyleKeywordTable,
} from "./intent-keyword-match";
import { createIntentSlashMatch } from "./intent-slash-match";
import { intentSequencerStateSchema } from "./intent-types";

const intentInputSchema = z.object({ message: z.string() }).passthrough();

export interface IntentSelectorOptions {
  /** Block name. Default `"intent-selector"`. */
  name?: string;
  /** Resource registry key for the skills collection. Default `"skills"`. */
  collectionKey?: string;
  /** Scope the skills collection is registered at. Default `"project"`. */
  scope?: ScopeType;
  /** Model the tier-3 classifier uses. Default `"preset/fast"`. */
  classifierModel?: string;
  /** Per-dimension confidence threshold. Default 0.65. */
  confidenceThreshold?: number;
  /** Cap on skills described in the classifier prompt. Default 20. */
  maxSkillsInClassifier?: number;
  /** Style keyword tables for tier 2. Empty disables the style-keyword scan. */
  thinkingStyleKeywords?: ThinkingStyleKeywordTable;
  /** Style category descriptions for tier 3 classifier prompt. */
  thinkingStyleCategories?: IntentClassifierOptions["thinkingStyleCategories"];
  /**
   * When `false`, intentSelector skips the auto-classification of thinking
   * style and leaves `session.state.thinkingStyle` untouched. Skill matching
   * still runs across all three tiers. Default `true`.
   */
  resolveThinkingStyle?: boolean;
  /**
   * When `false`, intentSelector skips tier 3 entirely (no LLM call) and
   * the apply handler runs against whatever tiers 1–2 produced. Default
   * `true`. Set `false` in tests that should not rely on a mocked classifier
   * and in deployments that want only deterministic tiers.
   */
  enableLlmClassifier?: boolean;
}

/**
 * Build the up-front intent selector sequencer.
 *
 * Returns a `.tap`-able block — it returns its input unchanged so it can
 * be chained ahead of downstream consumers without input-shape coupling.
 */
export function createIntentSelector(
  options: IntentSelectorOptions = {},
): BlockDefinition<typeof intentInputSchema, typeof intentInputSchema> {
  const collectionKey = options.collectionKey ?? "skills";
  const scope: ScopeType = options.scope ?? "project";
  const enableLlm = options.enableLlmClassifier ?? true;

  const slashTier = createIntentSlashMatch({ collectionKey, scope });
  const keywordTier = createIntentKeywordMatch({
    collectionKey,
    scope,
    thinkingStyleKeywords: options.thinkingStyleKeywords,
  });
  const apply = createApplyIntent({
    resolveThinkingStyle: options.resolveThinkingStyle,
  });

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
      scope,
      classifierModel: options.classifierModel,
      confidenceThreshold:
        options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
      maxSkillsInClassifier:
        options.maxSkillsInClassifier ?? DEFAULT_MAX_SKILLS,
      thinkingStyleCategories: options.thinkingStyleCategories,
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
