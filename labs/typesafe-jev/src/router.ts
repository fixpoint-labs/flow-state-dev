/**
 * Intent router driven by the evaluator (choice + confidence).
 *
 * One factory. Internally an FSD router: evaluator Choice over described
 * routes, then the selected child runs with the same input. `default` is
 * never a Choice option; it is the fallback when confidence is below
 * `minConfidence` or the choice is not a described route.
 *
 * Composition on evaluator answers — not a System One package.
 */

import { router, type BlockDefinition } from "@flow-state-dev/core";
import type { ZodTypeAny } from "zod";
import type { EvaluateClient } from "./client";
import { TypeSafeError } from "./errors";
import { DEFAULT_MIN_CONFIDENCE } from "./route";
import { asTypeSafeState, runEvaluate } from "./run-evaluate";
import { choice, isChoiceAnswer } from "./schemas";

/** Reserved route key. Never sent to Jev as a Choice option. */
export const SYSTEM_ONE_DEFAULT_ROUTE = "default";

/** Question id the router asks. Answers land under this key. */
export const SYSTEM_ONE_ROUTE_QUESTION = "route";

export interface SystemOneDescribedRoute<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> {
  /** Rubric for this option. Becomes the Choice criterion. */
  description: string;
  block: BlockDefinition<TInputSchema, TOutputSchema>;
}

export type SystemOneRouteEntry<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> =
  | BlockDefinition<TInputSchema, TOutputSchema>
  | SystemOneDescribedRoute<TInputSchema, TOutputSchema>;

export type SystemOneRouteMap<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> = {
  default: SystemOneRouteEntry<TInputSchema, TOutputSchema>;
} & Record<string, SystemOneRouteEntry<TInputSchema, TOutputSchema>>;

export interface SystemOneRouterConfig<
  TInputSchema extends ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> {
  name: string;
  /** Caller input. The whole value is the TypeSafe `state`. */
  inputSchema: TInputSchema;
  /**
   * Shared output contract for every route block. Defaults to the `default`
   * block's outputSchema.
   */
  outputSchema?: TOutputSchema;
  routes: SystemOneRouteMap<TInputSchema, TOutputSchema>;
  /** Choice instructions. Default asks which route should handle the input. */
  instructions?: string;
  /**
   * Below this, run `default`. TypeSafe's documented "unsure" floor is 0.5.
   * Point `default` at an escalate pipeline if low confidence should escalate.
   */
  minConfidence?: number;
  model?: unknown;
  fallbackModel?: string;
  mode?: "evaluate" | "system-2";
  apiKey?: string;
  client?: EvaluateClient;
}

function isDescribedRoute<I extends ZodTypeAny, O extends ZodTypeAny>(
  entry: SystemOneRouteEntry<I, O>,
): entry is SystemOneDescribedRoute<I, O> {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "description" in entry &&
    "block" in entry &&
    typeof (entry as SystemOneDescribedRoute).description === "string"
  );
}

function entryBlock<I extends ZodTypeAny, O extends ZodTypeAny>(
  entry: SystemOneRouteEntry<I, O>,
): BlockDefinition<I, O> {
  return isDescribedRoute(entry) ? entry.block : entry;
}

/**
 * Intent router driven by a Jev Choice. `default` is the confidence / no-match
 * fallback and is not offered as an option.
 *
 * ```ts
 * const routeMode = systemOneRouter({
 *   name: "route-mode",
 *   inputSchema: z.object({ message: z.string() }),
 *   routes: {
 *     plan: { description: "user is asking to plan something", block: planPipeline },
 *     review: { description: "user needs to review work just performed", block: reviewPipeline },
 *     default: chatPipeline,
 *   },
 * });
 * ```
 */
export function systemOneRouter<
  TInputSchema extends ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
>(
  config: SystemOneRouterConfig<TInputSchema, TOutputSchema>,
): BlockDefinition<TInputSchema, TOutputSchema> {
  if (config.routes.default === undefined) {
    throw new TypeSafeError(
      "invalid_routes",
      `systemOneRouter "${config.name}" needs a default route (fallback when confidence is low or no option matches).`,
    );
  }

  const described: Record<string, SystemOneDescribedRoute<TInputSchema, TOutputSchema>> = {};
  for (const [key, entry] of Object.entries(config.routes)) {
    if (key === SYSTEM_ONE_DEFAULT_ROUTE) continue;
    if (!isDescribedRoute(entry) || entry.description.trim() === "") {
      throw new TypeSafeError(
        "invalid_routes",
        `Route "${key}" needs { description, block }. Only default may be a bare block.`,
      );
    }
    described[key] = entry;
  }

  const describedKeys = Object.keys(described);
  if (describedKeys.length === 0) {
    throw new TypeSafeError(
      "invalid_routes",
      `systemOneRouter "${config.name}" needs at least one described route besides default.`,
    );
  }

  const defaultBlock = entryBlock(config.routes.default);
  const outputSchema = config.outputSchema ?? defaultBlock.config.outputSchema;
  if (outputSchema === undefined) {
    throw new TypeSafeError(
      "invalid_routes",
      `systemOneRouter "${config.name}" needs outputSchema, or the default block must declare one.`,
    );
  }

  const criteria: Record<string, string> = {};
  for (const [key, entry] of Object.entries(described)) {
    criteria[key] = entry.description;
  }

  const routeBlocks = [
    ...Object.values(described).map((entry) => entry.block),
    defaultBlock,
  ];

  const minConfidence = config.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const instructions =
    config.instructions ?? "Which route should handle this input? Pick the best match.";

  return router({
    name: config.name,
    inputSchema: config.inputSchema,
    outputSchema,
    routes: routeBlocks,
    execute: async (input) => {
      const result = await runEvaluate({
        state: asTypeSafeState(input),
        questions: {
          [SYSTEM_ONE_ROUTE_QUESTION]: choice(instructions, criteria),
        },
        model: config.model,
        fallbackModel: config.fallbackModel,
        mode: config.mode,
        apiKey: config.apiKey,
        client: config.client,
      });

      const answer = result.answers[SYSTEM_ONE_ROUTE_QUESTION];
      const confidence = isChoiceAnswer(answer) ? answer.confidence : undefined;
      if (
        !isChoiceAnswer(answer) ||
        typeof confidence !== "number" ||
        !Number.isFinite(confidence) ||
        confidence < minConfidence
      ) {
        return defaultBlock;
      }
      return described[answer.choice]?.block ?? defaultBlock;
    },
  });
}
