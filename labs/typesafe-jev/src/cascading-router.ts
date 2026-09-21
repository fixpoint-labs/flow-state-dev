/**
 * cascadingRouter — evaluate trees composed in code, not in the evaluator.
 *
 * Each hop is one atomic `runEvaluate` (one state + one questions map).
 * A branch is taken only when the choice matches **and** confidence (and
 * optional selected-option probability) clears the gate. Missing or low
 * confidence goes to `ambiguous`. Never guess.
 *
 * TypeSafe confidence comes from the evaluate path (`providerMetadata`).
 * System 2 has no calibrated confidence: the documented substitute is the
 * synthetic `confidence: 1` on a definite structured choice, so a tree
 * still compiles without Jev. Missing confidence still fail-closes.
 *
 * `evaluatedRouter` is reserved as a later single-level name. Use this
 * factory for trees; `systemOneRouter` remains the existing one-level map.
 */

import { router, type BlockDefinition } from "@flow-state-dev/core";
import type { ZodTypeAny } from "zod";
import type { EvaluateClient, EvaluateFn } from "./client";
import { TypeSafeError } from "./errors";
import { DEFAULT_MIN_CONFIDENCE } from "./route";
import { asTypeSafeState, runEvaluate } from "./run-evaluate";
import {
  choice,
  isChoiceAnswer,
  usableConfidence,
  type ChoiceQuestion,
  type TypeSafeEvaluateOutput,
} from "./schemas";
import type { GenerateStructuredFn } from "./system-2";

export const CASCADING_AMBIGUOUS = "ambiguous";

export const DEFAULT_CASCADE_QUESTION = "route";

const MAX_CASCADE_DEPTH = 8;

export interface CascadeGate {
  /** Below this, do not take the branch. Default 0.5. */
  minConfidence?: number;
  /** Optional floor on `probabilities[choice]`. Missing probability fail-closes. */
  minProbability?: number;
}

export interface CascadeLeaf<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> extends CascadeGate {
  description: string;
  block: BlockDefinition<TInputSchema, TOutputSchema>;
}

export interface CascadeFork<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> extends CascadeGate {
  description: string;
  next: CascadeQuestion<TInputSchema, TOutputSchema>;
}

export type CascadeBranch<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> = CascadeLeaf<TInputSchema, TOutputSchema> | CascadeFork<TInputSchema, TOutputSchema>;

export interface CascadeQuestion<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> {
  /** Answer key for this hop. Default `"route"`. */
  id?: string;
  instructions: string;
  branches: Record<string, CascadeBranch<TInputSchema, TOutputSchema>>;
}

export interface CascadingRouterConfig<
  TInputSchema extends ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> {
  name: string;
  inputSchema: TInputSchema;
  outputSchema?: TOutputSchema;
  root: CascadeQuestion<TInputSchema, TOutputSchema>;
  /** Fail-closed exit. Required — missing/low confidence never picks a high branch. */
  ambiguous: BlockDefinition<TInputSchema, TOutputSchema>;
  model?: unknown;
  fallbackModel?: string;
  mode?: "evaluate" | "system-2";
  apiKey?: string;
  client?: EvaluateClient;
  evaluate?: EvaluateFn;
  generate?: GenerateStructuredFn;
}

function isLeaf<I extends ZodTypeAny, O extends ZodTypeAny>(
  branch: CascadeBranch<I, O>,
): branch is CascadeLeaf<I, O> {
  return "block" in branch && branch.block !== undefined;
}

function isFork<I extends ZodTypeAny, O extends ZodTypeAny>(
  branch: CascadeBranch<I, O>,
): branch is CascadeFork<I, O> {
  return "next" in branch && branch.next !== undefined;
}

function collectLeaves<I extends ZodTypeAny, O extends ZodTypeAny>(
  question: CascadeQuestion<I, O>,
  out: BlockDefinition<I, O>[],
): void {
  for (const branch of Object.values(question.branches)) {
    if (isLeaf(branch) && isFork(branch)) {
      throw new TypeSafeError(
        "invalid_routes",
        "A cascade branch cannot have both block and next.",
      );
    }
    if (isLeaf(branch)) {
      out.push(branch.block);
      continue;
    }
    if (isFork(branch)) {
      collectLeaves(branch.next, out);
      continue;
    }
    throw new TypeSafeError(
      "invalid_routes",
      "A cascade branch needs block (leaf) or next (another question).",
    );
  }
}

function criteriaOf<I extends ZodTypeAny, O extends ZodTypeAny>(
  question: CascadeQuestion<I, O>,
): ChoiceQuestion["criteria"] {
  const criteria: Record<string, string> = {};
  for (const [key, branch] of Object.entries(question.branches)) {
    if (branch.description.trim() === "") {
      throw new TypeSafeError("invalid_routes", `Cascade branch "${key}" needs a description.`);
    }
    criteria[key] = branch.description;
  }
  return criteria;
}

function selectedProbability(answer: { choice: string; probabilities?: Record<string, number> }) {
  const value = answer.probabilities?.[answer.choice];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * True when this edge may be taken. Missing confidence or probability fail-closes.
 */
export function cascadeGateOpen(
  result: TypeSafeEvaluateOutput,
  questionId: string,
  branchKey: string,
  gate: CascadeGate,
): boolean {
  const answer = result.answers[questionId];
  if (!isChoiceAnswer(answer) || answer.choice !== branchKey) return false;

  const confidence = usableConfidence(answer.confidence);
  if (confidence === undefined) return false;
  const minConfidence = gate.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  if (confidence < minConfidence) return false;

  if (gate.minProbability !== undefined) {
    const probability = selectedProbability(answer);
    if (probability === undefined || probability < gate.minProbability) return false;
  }
  return true;
}

/**
 * Composed router: evaluate → gated branch → leaf block or the next question.
 *
 * ```ts
 * cascadingRouter({
 *   name: "triage",
 *   inputSchema,
 *   root: {
 *     id: "department",
 *     instructions: "Which team?",
 *     branches: {
 *       billing: {
 *         description: "Charges and refunds",
 *         minConfidence: 0.6,
 *         next: { id: "urgency", instructions: "How urgent?", branches: { ... } },
 *       },
 *       technical: { description: "Bugs", block: techQueue },
 *     },
 *   },
 *   ambiguous: review,
 * });
 * ```
 */
export function cascadingRouter<
  TInputSchema extends ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
>(
  config: CascadingRouterConfig<TInputSchema, TOutputSchema>,
): BlockDefinition<TInputSchema, TOutputSchema> {
  const leaves: BlockDefinition<TInputSchema, TOutputSchema>[] = [];
  collectLeaves(config.root, leaves);
  if (leaves.length === 0) {
    throw new TypeSafeError(
      "invalid_routes",
      `cascadingRouter "${config.name}" needs at least one leaf block.`,
    );
  }

  const outputSchema = config.outputSchema ?? config.ambiguous.config.outputSchema;
  if (outputSchema === undefined) {
    throw new TypeSafeError(
      "invalid_routes",
      `cascadingRouter "${config.name}" needs outputSchema, or the ambiguous block must declare one.`,
    );
  }

  return router({
    name: config.name,
    inputSchema: config.inputSchema,
    outputSchema,
    routes: [...leaves, config.ambiguous],
    execute: async (input) => {
      const state = asTypeSafeState(input);
      let current = config.root;
      for (let depth = 0; depth < MAX_CASCADE_DEPTH; depth += 1) {
        const questionId = current.id ?? DEFAULT_CASCADE_QUESTION;
        const result = await runEvaluate({
          state,
          questions: {
            [questionId]: choice(current.instructions, criteriaOf(current)),
          },
          model: config.model,
          fallbackModel: config.fallbackModel,
          mode: config.mode,
          apiKey: config.apiKey,
          client: config.client,
          evaluate: config.evaluate,
          generate: config.generate,
        });

        const answer = result.answers[questionId];
        if (!isChoiceAnswer(answer)) return config.ambiguous;
        const branch = current.branches[answer.choice];
        if (branch === undefined) return config.ambiguous;
        if (!cascadeGateOpen(result, questionId, answer.choice, branch)) {
          return config.ambiguous;
        }
        if (isLeaf(branch)) return branch.block;
        current = branch.next;
      }
      return config.ambiguous;
    },
  });
}
