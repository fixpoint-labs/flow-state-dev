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
 * Tier 3 can instead run on an app-supplied evaluator block (`evaluator`,
 * usually `skillEvaluator(model)`): it picks one skill or none from the same
 * catalog, and its answer is final. With an evaluator passed, the generator
 * classifier is not built, so nothing can fall back to it.
 *
 * Tier-3 LLM classification is opt-out via `enableLlmClassifier: false`, and
 * tier-2 keyword matching is opt-out via `enableKeywordMatch: false` — useful
 * in tests and in deployments that only want a subset of the tiers.
 */

import { z } from "zod";
import { assertEvaluatorBlock, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import type { ExplicitActivationScope } from "./activation-store";
import {
  isInitialSkillsResolver,
  type InitialSkillsSource,
} from "./initial-skills";
import { createApplySkillActivation } from "./apply-skill-activation";
import { createCatalogSeedStep } from "./seed-step";
import {
  createSkillClassifierSequencer,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_MAX_SKILLS,
} from "./skill-classifier-gen";
import {
  createSkillEvaluatorTier,
  type AnyEvaluatorBlock,
} from "./skill-evaluator-tier";
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
   * When `false`, skillActivator skips tier 2 (keyword scan) entirely. The
   * apply handler runs against whatever the slash tier — and, if enabled,
   * the classifier — produced. Default `true`, preserving today's pipeline
   * for orchestration's own callers. The built-in `agent` kind
   * (`@flow-state-dev/workforce`) is the one caller that sets this `false`:
   * keyword matching is not part of that kind's contract.
   */
  enableKeywordMatch?: boolean;
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
  /**
   * Bundled defaults to seed **before** the matcher tiers scan the collection.
   * The matcher runs upstream of the generator, so it can't rely on the binding
   * reader's lazy seeding — on a fresh collection the slash/keyword/classifier
   * tiers would otherwise see an empty catalog on turn 1 and match nothing.
   * Pass the same `initialSkills` given to `createSkillsLibrary` — including a
   * per-execution resolver, which is resolved at the seed step against that
   * turn's own context.
   */
  initialSkills?: InitialSkillsSource;
  /**
   * Run tier 3 on this evaluator block instead of the generator classifier.
   * Usually `skillEvaluator(model)`; a hand-built evaluator must ask
   * `skillQuestions`. The activator hands it `{ message, skills }` (the same
   * allowed, model-invocable, capped catalog the classifier would describe)
   * and activates its pick: one skill, or none. The pick is final: no
   * confidence threshold applies, and an evaluator error fails the activator
   * rather than falling back to the classifier.
   *
   * Refused alongside `classifierModel`, `confidenceThreshold` or
   * `enableLlmClassifier: false`, which configure the classifier this
   * replaces.
   */
  evaluator?: AnyEvaluatorBlock;
}

/** Refuse, when the activator is built, an `evaluator` that can't be one or clashes with classifier options. */
function checkEvaluatorOption(options: SkillActivatorOptions): void {
  const block = options.evaluator as unknown;
  if (block === undefined) return;
  assertEvaluatorBlock(block, {
    slot: 'createSkillActivator: "evaluator"',
    helper: "skillEvaluator(model)",
    questions: "skillQuestions",
  });
  const clashing = [
    options.classifierModel !== undefined ? "classifierModel" : undefined,
    options.confidenceThreshold !== undefined ? "confidenceThreshold" : undefined,
    options.enableLlmClassifier === false ? "enableLlmClassifier: false" : undefined,
  ].filter((o): o is string => o !== undefined);
  if (clashing.length > 0) {
    throw new Error(
      `createSkillActivator: "evaluator" can't be combined with ${clashing.join(", ")}. ` +
        "Those options configure the generator classifier, which the evaluator replaces.",
    );
  }
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
  checkEvaluatorOption(options);
  const collectionKey = options.collectionKey ?? "skills";
  const enableLlm = options.enableLlmClassifier ?? true;
  const enableKeyword = options.enableKeywordMatch ?? true;

  const allowed = options.allowed;
  const slashTier = createSkillSlashMatch({
    collectionKey,
    ...(allowed ? { allowed } : {}),
  });
  const apply = createApplySkillActivation({
    collectionKey,
    ...(options.activeState ? { activeState: options.activeState } : {}),
    ...(allowed ? { allowed } : {}),
  });

  // Seed the catalog before any tier reads it — the matcher runs upstream of
  // the generator, so it can't rely on the binding reader's lazy seeding.
  const initialSkills = options.initialSkills;
  const seedStep = createCatalogSeedStep({
    collectionKey,
    ...(initialSkills ? { initialSkills } : {}),
  });

  let pipeline = sequencer({
    name: options.name ?? "skill-activator",
    inputSchema: activatorInputSchema,
    stateSchema: skillActivatorStateSchema,
  });

  // Only prepend the seed step when there are bundled defaults to seed. Under a
  // RESOLVER there is no build-time answer to that question, so the step is
  // always prepended and decides per turn — it returns before any storage read
  // when the resolver hands back nothing.
  if (isInitialSkillsResolver(initialSkills) || (initialSkills && initialSkills.length > 0)) {
    pipeline = pipeline.tap(seedStep);
  }

  pipeline = pipeline.tap(slashTier);

  if (enableKeyword) {
    const keywordTier = createSkillKeywordMatch({
      collectionKey,
      ...(allowed ? { allowed } : {}),
    });
    pipeline = pipeline.tapIf(
      (_input, ctx) => !ctx.sequencer?.state.resolved,
      keywordTier,
    );
  }

  if (options.evaluator !== undefined) {
    // The generator classifier is not built on this path, so no failure or
    // branch can reach it.
    const evaluatorTier = createSkillEvaluatorTier({
      collectionKey,
      evaluator: options.evaluator,
      maxSkillsInClassifier:
        options.maxSkillsInClassifier ?? DEFAULT_MAX_SKILLS,
      ...(allowed ? { allowed } : {}),
    });
    pipeline = pipeline.tapIf(
      (_input, ctx) => !ctx.sequencer?.state.resolved,
      evaluatorTier,
    );
  } else if (enableLlm) {
    const classifier = createSkillClassifierSequencer({
      collectionKey,
      classifierModel: options.classifierModel,
      confidenceThreshold:
        options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
      maxSkillsInClassifier:
        options.maxSkillsInClassifier ?? DEFAULT_MAX_SKILLS,
      ...(allowed ? { allowed } : {}),
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
