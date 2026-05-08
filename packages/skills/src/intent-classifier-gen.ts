/**
 * Tier 3 of intentSelector — LLM skill classifier.
 *
 * One generator call decides whether any skill in the catalog applies to
 * the user message. Returns zero-or-more matches with per-match confidence;
 * an apply handler filters out skills not in the catalog (a hallucination
 * guard) and applies the confidence threshold.
 *
 * `agentType: "trace"` hides emissions from both the client stream and the
 * LLM history — the classification is observability-only, never visible to
 * the main generator's chat history.
 */

import { z } from "zod";
import { generator, handler, sequencer } from "@flow-state-dev/core";
import type {
  ResourceCollectionRef,
} from "@flow-state-dev/core/types";
import type { SkillState } from "@flow-state-dev/core";
import { getCollection } from "./internal/get-collection";
import {
  intentSequencerStateSchema,
  matchedSkillSchema,
} from "./intent-types";

/** Default confidence threshold matching FIX-311's classifier gate. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.65;

/** Default cap on the number of skills sent to the classifier prompt. */
export const DEFAULT_MAX_SKILLS = 20;

const inputSchema = z.object({ message: z.string() }).passthrough();

/** Public so consumers can mock against this shape if they ever need to. */
export const intentClassifierOutputSchema = z.object({
  /** Anchoring mitigation: ask the model to think before labeling. */
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
  collectionKey: string;
  /** Model to drive the classifier with. Default `"intent/utility"`. */
  classifierModel?: string;
  /** Confidence threshold for accepting a match. */
  confidenceThreshold?: number;
  /** Maximum number of skills described in the classifier prompt. */
  maxSkillsInClassifier?: number;
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
 * Build the tier-3 classifier — generator call + apply handler wrapped in
 * a sequencer. The sequencer is what `intentSelector`'s `tapIf` targets.
 */
export function createIntentClassifierSequencer(opts: IntentClassifierOptions) {
  const cap = opts.maxSkillsInClassifier ?? DEFAULT_MAX_SKILLS;
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  const classifier = generator({
    name: "intent-classifier",
    model: opts.classifierModel ?? "intent/utility",
    inputSchema,
    outputSchema: intentClassifierOutputSchema,
    agentType: "trace",
    prompt: async (_input, ctx) => {
      const collection = getCollection(ctx, opts.collectionKey);
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

  const apply = handler({
    name: "apply-classifier-result",
    inputSchema: intentClassifierOutputSchema,
    outputSchema: z.object({ accepted: z.boolean() }),
    sequencerStateSchema: intentSequencerStateSchema,
    execute: async (input, ctx) => {
      const collection = getCollection(ctx, opts.collectionKey);
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
        .filter((s) => validNames.has(s.name) && s.confidence >= threshold)
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
      });
      return { accepted: true };
    },
  });

  return sequencer({ name: "intent-classifier-tier", inputSchema })
    .then((input) => ({ message: (input as { message: string }).message }), classifier)
    .tap(apply);
}
