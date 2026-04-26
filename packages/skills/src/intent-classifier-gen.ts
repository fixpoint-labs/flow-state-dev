/**
 * Tier 3 of intentSelector — LLM skill classifier.
 *
 * One generator call decides whether any skill in the catalog applies to
 * the user message. Returns zero-or-more matches with per-match confidence;
 * the apply handler filters out skills not in the catalog (a hallucination
 * guard) and applies the confidence threshold.
 *
 * `agentType: "trace"` hides emissions from both the client stream and the
 * LLM history (resolve-visibility.ts) — the classification is observability-
 * only, never visible to the main generator's chat history.
 */

import { z } from "zod";
import { generator, handler, sequencer } from "@flow-state-dev/core";
import type {
  BlockContext,
  ResourceCollectionRef,
  ScopeType,
} from "@flow-state-dev/core/types";
import type { SkillState } from "@flow-state-dev/core";
import {
  intentSequencerStateSchema,
  matchedSkillSchema,
} from "./intent-types";

/** Default confidence threshold matching FIX-311's classifier gate. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.65;

/** Default cap on the number of skills sent to the classifier prompt. */
export const DEFAULT_MAX_SKILLS = 20;

const inputSchema = z.object({ message: z.string() }).passthrough();

/** Public — exported so consumers/tests can mock against it. */
export const intentClassifierOutputSchema = z.object({
  /** Per anchoring mitigation: ask the model to think before labeling. */
  reasoning: z.string(),
  activeSkills: z.array(
    z.object({
      name: z.string(),
      input: z.string().default(""),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export type IntentClassifierOutput = z.infer<typeof intentClassifierOutputSchema>;

export interface IntentClassifierOptions {
  /** Block name. Default `"intent-classifier"`. */
  name?: string;
  collectionKey: string;
  scope: ScopeType;
  /** Model to drive the classifier with. Default `"preset/fast"`. */
  classifierModel?: string;
  /** Confidence threshold for accepting a match. */
  confidenceThreshold?: number;
  /** Maximum number of skills described in the classifier prompt. */
  maxSkillsInClassifier?: number;
}

/** Resolve the skills collection ref from the appropriate scope registry. */
function getCollection(
  ctx: BlockContext,
  scope: ScopeType,
  key: string,
): ResourceCollectionRef | undefined {
  const registry =
    scope === "session"
      ? ctx.session?.resources
      : scope === "user"
        ? ctx.user?.resources
        : ctx.project?.resources;
  if (!registry) return undefined;
  const get = (registry as { get?: (k: string) => unknown }).get;
  if (typeof get === "function") {
    const ref = get.call(registry, key);
    if (ref && typeof ref === "object" && "pattern" in ref) {
      return ref as ResourceCollectionRef;
    }
  }
  const list = (registry as { list?: () => unknown[] }).list;
  if (typeof list === "function") {
    for (const entry of list.call(registry)) {
      if (
        entry &&
        typeof entry === "object" &&
        "pattern" in (entry as object) &&
        "create" in (entry as object)
      ) {
        const ref = entry as ResourceCollectionRef;
        if (ref.pattern.startsWith(`${key}/`)) return ref;
      }
    }
  }
  return undefined;
}

/** List enabled skills (capped) with their description for the prompt. */
function listSkillsForPrompt(
  collection: ResourceCollectionRef | undefined,
  cap: number,
): Array<{ name: string; description: string }> {
  if (!collection) return [];
  const out: Array<{ name: string; description: string }> = [];
  const seen = new Set<string>();
  for (const ref of collection.list()) {
    if (out.length >= cap) break;
    if (!ref.name.endsWith("/SKILL.md")) continue;
    const segments = ref.name.split("/");
    if (segments.length < 2) continue;
    const skillName = segments[segments.length - 2]!;
    if (seen.has(skillName)) continue;
    seen.add(skillName);
    const state = ref.state as unknown as SkillState;
    if (state.disableModelInvocation) continue;
    let desc = state.description ?? "";
    if (state.whenToUse) desc = `${desc}\n${state.whenToUse}`;
    out.push({ name: skillName, description: desc });
  }
  return out;
}

/**
 * Build the classifier generator. Output is the structured-object form per
 * `intentClassifierOutputSchema`.
 */
export function createIntentClassifierGenerator(opts: IntentClassifierOptions) {
  const cap = opts.maxSkillsInClassifier ?? DEFAULT_MAX_SKILLS;

  return generator({
    name: opts.name ?? "intent-classifier",
    model: opts.classifierModel ?? "preset/fast",
    inputSchema,
    outputSchema: intentClassifierOutputSchema,
    agentType: "trace",
    prompt: async (_input, ctx) => {
      const collection = getCollection(ctx, opts.scope, opts.collectionKey);
      const skills = listSkillsForPrompt(collection, cap);
      if (skills.length === 0) {
        return [
          "You classify a single user message: which (if any) of the available skills applies?",
          "No skills are currently registered. Always return `activeSkills: []`.",
          "Return your reasoning first (one short sentence).",
        ].join("\n");
      }
      const skillSection = [
        "Available skills (you may activate zero or more — only when the message clearly matches):",
        ...skills.map((s) => `- ${s.name}: ${s.description}`),
      ].join("\n");
      return [
        "You classify a single user message: which (if any) of the available skills applies?",
        "Return your reasoning first (one short sentence), then zero-or-more skill matches with per-match confidence in 0..1.",
        "If no skill clearly applies, return an empty `activeSkills` array. Do not invent skill names not in the catalog.",
        "",
        skillSection,
      ].join("\n");
    },
    user: (input) => (input as { message: string }).message,
  });
}

const applySchema = z.object({ accepted: z.boolean() });

/**
 * Apply the classifier output to the cross-tier sequencer state. Filters out
 * skills not present in the catalog and gates on the confidence threshold.
 */
export function createApplyClassifierResult(opts: IntentClassifierOptions) {
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  return handler({
    name: "apply-classifier-result",
    inputSchema: intentClassifierOutputSchema,
    outputSchema: applySchema,
    sequencerStateSchema: intentSequencerStateSchema,
    execute: async (input, ctx) => {
      const collection = getCollection(ctx, opts.scope, opts.collectionKey);
      const validNames = new Set<string>();
      if (collection) {
        for (const ref of collection.list()) {
          if (!ref.name.endsWith("/SKILL.md")) continue;
          const segments = ref.name.split("/");
          if (segments.length < 2) continue;
          const skillName = segments[segments.length - 2]!;
          const state = ref.state as unknown as SkillState;
          if (state.disableModelInvocation) continue;
          validNames.add(skillName);
        }
      }

      const filteredSkills = input.activeSkills
        .filter((s) => validNames.has(s.name))
        .filter((s) => s.confidence >= threshold)
        .map((s) =>
          matchedSkillSchema.parse({
            name: s.name,
            input: s.input ?? "",
            source: "classifier" as const,
            confidence: s.confidence,
          }),
        );

      const aggregateConfidence =
        filteredSkills.length === 0
          ? 0
          : filteredSkills.reduce((acc, s) => acc + (s.confidence ?? 0), 0) /
            filteredSkills.length;

      const existingSkills = ctx.sequencer?.state.skills ?? [];
      await ctx.sequencer!.patchState({
        resolved: true,
        skills: [...existingSkills, ...filteredSkills],
        classifierConfidence: aggregateConfidence,
        source: "classifier" as const,
      });
      return { accepted: true };
    },
  });
}

/**
 * Convenience: build the classifier generator + apply handler wrapped in a
 * sequencer. This is what intentSelector's tier-3 `tapIf` actually targets.
 */
export function createIntentClassifierSequencer(opts: IntentClassifierOptions) {
  const classifier = createIntentClassifierGenerator(opts);
  const apply = createApplyClassifierResult(opts);
  return sequencer({
    name: "intent-classifier-tier",
    inputSchema,
  })
    .then((input) => ({ message: (input as { message: string }).message }), classifier)
    .tap(apply);
}
