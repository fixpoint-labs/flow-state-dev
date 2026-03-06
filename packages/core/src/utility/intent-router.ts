import { z } from "zod";
import type { GeneratorConfig } from "../blocks";
import { handler, router, sequencer } from "../blocks";
import type { BlockDefinition } from "../types/block";
import {
  intentClassifier,
  type IntentClassifierOutput
} from "./intent-classifier";

export type IntentRouterCategory = {
  description: string;
  handler: BlockDefinition;
};

export type IntentRouterCategories = Record<string, IntentRouterCategory>;

export interface IntentRouterConfig<
  TCategories extends IntentRouterCategories
> {
  name: string;
  categories: TCategories;
  fallback?: BlockDefinition;
  confidenceThreshold?: number;
  model?: GeneratorConfig["model"];
}

type IntentRouterEnvelope = {
  originalInput: unknown;
  classification: IntentClassifierOutput;
};

function toClassifierCategories(categories: IntentRouterCategories): Record<string, string> {
  return Object.fromEntries(
    Object.entries(categories).map(([label, category]) => [label, category.description])
  );
}

/**
 * Factory that returns a sequencer pre-wired to classify input intent and route to category handlers.
 */
export function intentRouter<TCategories extends IntentRouterCategories>(
  config: IntentRouterConfig<TCategories>
) {
  const categoryEntries = Object.entries(config.categories);

  if (categoryEntries.length < 2) {
    throw new Error('intentRouter requires at least 2 categories in the "categories" map');
  }

  const classifier = intentClassifier({
    name: `${config.name}-intent-classifier`,
    categories: toClassifierCategories(config.categories),
    model: config.model
  });

  const wrappedCategoryRoutes = new Map<string, BlockDefinition>(
    categoryEntries.map(([category, value]) => [
      category,
      value.handler.connectInput((input: IntentRouterEnvelope) => input.originalInput)
    ])
  );

  const wrappedFallback = config.fallback?.connectInput(
    (input: IntentRouterEnvelope) => input.originalInput
  );

  const classifyInput = handler({
    name: `${config.name}-intent-router-input`,
    outputSchema: z.object({
      originalInput: z.unknown(),
      classification: z.object({
        category: z.string(),
        confidence: z.number(),
        reasoning: z.string().optional()
      })
    }),
    execute: async (input, ctx) => {
      const classification = await classifier.run(input, ctx);
      return {
        originalInput: input,
        classification
      };
    }
  });

  const dispatcher = router({
    name: `${config.name}-intent-router`,
    routes: [
      ...wrappedCategoryRoutes.values(),
      ...(wrappedFallback === undefined ? [] : [wrappedFallback])
    ],
    execute: (input: IntentRouterEnvelope) => {
      if (
        config.confidenceThreshold !== undefined &&
        input.classification.confidence < config.confidenceThreshold
      ) {
        if (wrappedFallback !== undefined) {
          return wrappedFallback;
        }

        throw new Error(
          `intentRouter "${config.name}" classified "${input.classification.category}" with confidence ${input.classification.confidence}, below threshold ${config.confidenceThreshold}, and no fallback handler was provided`
        );
      }

      const route = wrappedCategoryRoutes.get(input.classification.category);
      if (route !== undefined) {
        return route;
      }

      if (wrappedFallback !== undefined) {
        return wrappedFallback;
      }

      throw new Error(
        `intentRouter "${config.name}" produced unknown category "${input.classification.category}" and no fallback handler was provided`
      );
    }
  });

  return sequencer({
    name: config.name,
    inputSchema: z.any()
  })
    .then(classifyInput)
    .then(dispatcher);
}
