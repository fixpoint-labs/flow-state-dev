/**
 * Shared config shape for the thinking-style pipeline builders.
 *
 * The router factory (`../create-router.ts`) narrows the public
 * `ThinkingStyleRouterConfig` into this shape and threads it to each
 * `createXPipeline(config)` builder. Kept in its own type-only module so a
 * builder shares the definition without importing it back from the factory.
 *
 * It carried context, capability and instruction slots while five
 * coordination-pattern pipelines built sub-agent generators from it. Those
 * pipelines were removed (FIX-1478); the one builder left declares its worker
 * bare, on purpose, and reads only the model.
 */

/** Config a pipeline builder is handed by the router factory. */
export interface PipelineConfig {
  /** Model ID string or a selectModel() resolver. */
  modelId: string | ((input: any, ctx: any) => any);
}
