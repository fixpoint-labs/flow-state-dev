/**
 * Tier 3 of intentSelector — multi-dimensional LLM classifier.
 *
 * One generator call covers two classification dimensions at once: thinking
 * style and active-skill selection. Two parallel single-dim classifier
 * calls would double latency on the fall-through path; a unified prompt
 * pays it once.
 *
 * The prompt asks the model to emit `reasoning` first (anchoring
 * mitigation), then per-dimension labels with per-dimension confidence.
 * `agentType: "trace"` hides emissions from both the client stream and
 * the LLM history (resolve-visibility.ts) — the classification is
 * observability-only, never visible to the main generator's chat history.
 *
 * The classifier is wrapped in a tiny sequencer with an apply handler so
 * its output writes into the cross-tier sequencer state. The handler also
 * filters out skill names not present in the catalog (a hallucination
 * guard) and applies the per-dimension confidence threshold.
 */

import { z } from "zod";
import { generator, handler, sequencer } from "@flow-state-dev/core";
import type {
  BlockContext,
  ResourceCollectionRef,
  ScopeType,
} from "@flow-state-dev/core/types";
import { thinkingStyleSchema } from "@flow-state-dev/core/types";
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
  thinkingStyle: thinkingStyleSchema,
  thinkingStyleConfidence: z.number().min(0).max(1),
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
  /** Per-dimension confidence threshold for accepting a label. */
  confidenceThreshold?: number;
  /** Maximum number of skills described in the classifier prompt. */
  maxSkillsInClassifier?: number;
  /**
   * Map of thinking-style identifier → category description sent to the
   * classifier. The model picks one. `"default"` is implied when no other
   * style fits.
   */
  thinkingStyleCategories?: Partial<Record<
    z.infer<typeof thinkingStyleSchema>,
    string
  >>;
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

const DEFAULT_THINKING_STYLE_CATEGORIES: Record<string, string> = {
  "plan-and-execute":
    "The message asks for a multi-step task that benefits from explicit decomposition before execution.",
  supervisor:
    "The message describes work spanning multiple specialized concerns that benefit from independent sub-agent treatment.",
  blackboard:
    "The message asks for analysis where multiple expert perspectives contribute incrementally to a shared workspace under a controller.",
  "reactive-blackboard":
    "The message asks for parallel analysis from multiple independent perspectives, synthesized at the end.",
  default:
    "The message is a direct question or single-shot reasoning task with no need for decomposition or multi-agent coordination.",
};

/**
 * Build the classifier generator. Output is the structured-object form per
 * `intentClassifierOutputSchema`.
 */
export function createIntentClassifierGenerator(opts: IntentClassifierOptions) {
  const cap = opts.maxSkillsInClassifier ?? DEFAULT_MAX_SKILLS;
  const styleCategories = {
    ...DEFAULT_THINKING_STYLE_CATEGORIES,
    ...opts.thinkingStyleCategories,
  };

  return generator({
    name: opts.name ?? "intent-classifier",
    model: opts.classifierModel ?? "preset/fast",
    inputSchema,
    outputSchema: intentClassifierOutputSchema,
    agentType: "trace",
    prompt: async (_input, ctx) => {
      const collection = getCollection(ctx, opts.scope, opts.collectionKey);
      const skills = listSkillsForPrompt(collection, cap);
      const skillSection =
        skills.length === 0
          ? "No skills are currently registered. Always return `activeSkills: []`."
          : [
              "Available skills (you may activate zero or more):",
              ...skills.map((s) => `- ${s.name}: ${s.description}`),
            ].join("\n");
      const styleSection = [
        "Thinking-style categories (pick exactly one):",
        ...Object.entries(styleCategories).map(
          ([style, desc]) => `- ${style}: ${desc}`,
        ),
      ].join("\n");
      return [
        "You classify a single user message along two independent dimensions: a thinking style and zero-or-more skill matches.",
        "Return your reasoning first (one short paragraph), then the labels with per-dimension confidence in the range 0..1.",
        "If no skill clearly applies, return an empty `activeSkills` array. Do not invent skill names not in the catalog.",
        "If no specialized thinking style fits, pick `default`.",
        "",
        styleSection,
        "",
        skillSection,
      ].join("\n");
    },
    user: (input) => (input as { message: string }).message,
  });
}

const applySchema = z.object({
  /** The accepted output (already filtered against the catalog). */
  accepted: z.boolean(),
});

/**
 * Apply the classifier output to the cross-tier sequencer state. Filters out
 * skills not present in the catalog and gates per-dimension on the
 * confidence threshold. On any failure (parse, model error), the apply
 * handler is simply not reached — the sequencer's outer state stays at its
 * defaults and the apply-intent step at the end of intentSelector reads
 * `thinkingStyle: null`, falling through to its default behavior.
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

      const styleAccepted =
        input.thinkingStyleConfidence >= threshold ? input.thinkingStyle : "default";

      const existingSkills = ctx.sequencer?.state.skills ?? [];
      await ctx.sequencer!.patchState({
        resolved: true,
        thinkingStyle: styleAccepted,
        thinkingStyleSource:
          ctx.sequencer?.state.thinkingStyleSource ?? "classifier",
        skills: [...existingSkills, ...filteredSkills],
        classifierConfidence: input.thinkingStyleConfidence,
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
