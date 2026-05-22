/**
 * `keyedRouter` — string-keyed dispatch built on top of `router`.
 *
 * Picks one of `blocks[select(input, ctx)]`. Promoted from three
 * hand-rolled routers across the patterns package (dispatch-specialist,
 * task-board worker registry, debate speaker dispatch). Unknown keys
 * throw with the registered key list; pass `fallback` to route
 * unknowns to a default block instead.
 *
 * Input adaptation is intentionally NOT part of this primitive per
 * BP-013: pre-connect adapters on the routed blocks themselves
 * (`block.connectInput(...)`), or wrap the whole router. Keep this
 * surface tight.
 */
import type { ZodTypeAny, z } from "zod";
import { router, type RouterConfig } from "../blocks/router";
import type { BlockContext, BlockDefinition } from "../types/block";

export interface KeyedRouterConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
> {
  name: string;
  /** String-keyed routing table. Keys are the values `select` returns. */
  blocks: Record<string, BlockDefinition<any, any>>;
  select: (input: TInput, ctx: BlockContext) => string;
  /**
   * Optional block to run when `select` returns a key absent from
   * `blocks`. Without a fallback, an unknown key throws with the list
   * of registered keys for fast debugging.
   */
  fallback?: BlockDefinition<any, any>;
  inputSchema?: TInputSchema;
  outputSchema?: TOutputSchema;
}

/**
 * Build a router that selects one of `blocks[select(input, ctx)]`.
 * Throws with the registered key list when no entry matches and no
 * `fallback` is given.
 */
export function keyedRouter<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
>(
  config: KeyedRouterConfig<TInputSchema, TOutputSchema, TInput>,
): BlockDefinition<TInputSchema, TOutputSchema> {
  const { name, blocks, select, fallback, inputSchema, outputSchema } = config;
  const registeredRoutes = Object.values(blocks);
  const routes =
    fallback !== undefined && !registeredRoutes.includes(fallback)
      ? [...registeredRoutes, fallback]
      : registeredRoutes;

  const routerConfig = {
    name,
    ...(inputSchema !== undefined ? { inputSchema } : {}),
    ...(outputSchema !== undefined ? { outputSchema } : {}),
    routes,
    execute: (input: TInput, ctx: BlockContext) => {
      const key = select(input, ctx);
      const selected = blocks[key];
      if (selected !== undefined) return selected;
      if (fallback !== undefined) return fallback;
      throw new Error(
        `[keyedRouter] no block registered under key "${key}" in router "${name}". ` +
          `Available: ${Object.keys(blocks).join(", ")}`,
      );
    },
  } as unknown as RouterConfig<TInputSchema, TOutputSchema, TInput>;

  return router(routerConfig) as BlockDefinition<TInputSchema, TOutputSchema>;
}
