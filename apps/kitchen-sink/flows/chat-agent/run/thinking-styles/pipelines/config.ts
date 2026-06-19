/**
 * Shared config shape for the thinking-style pipeline builders.
 *
 * The router factory (`../index.ts`) normalizes the public
 * `ThinkingStyleRouterConfig` into this resolved shape (worker defaults filled
 * in) and threads it to each `createXPipeline(config)` builder. Kept in its own
 * type-only module so the five pipeline builders share one definition without
 * importing it back from the factory.
 */
import type { GeneratorHistoryConfig, GeneratorSlot, UsesSlot } from "@flow-state-dev/core";

/** Resolvable instructions string — static or computed from input + context. */
export type InstructionsSlot =
  | string
  | ((input: any, ctx: any) => string | Promise<string>);

/** Resolved pipeline config: worker defaults already filled in by the factory. */
export interface PipelineConfig {
  /** Model ID string or a selectModel() resolver. */
  modelId: string | ((input: any, ctx: any) => any);
  /** Context bundle for the pattern's primary blocks. */
  context: GeneratorSlot<any, any>;
  /** Context bundle for sub-agent worker generators. */
  workerContext: GeneratorSlot<any, any>;
  /** Capabilities installed on the pattern's primary blocks. */
  uses?: UsesSlot;
  /** Capabilities installed on sub-agent worker generators. */
  workerUses?: UsesSlot;
  /** Generator history config shared across the pattern's generators. */
  history?: GeneratorHistoryConfig<any, any>;
  /** Overall instructions passed to pattern sub-blocks (planner, controller, synthesizer). */
  instructions?: InstructionsSlot;
}
