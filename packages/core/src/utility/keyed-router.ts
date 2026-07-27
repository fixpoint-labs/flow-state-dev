/**
 * `keyedRouter` — string-keyed dispatch built on top of `router`.
 *
 * Picks one of `blocks[select(input, ctx)]`. Promoted from three
 * hand-rolled routers across the patterns package (dispatch-specialist,
 * task-board worker registry, debate speaker dispatch). Unknown keys
 * throw with the registered key list; pass `fallback` to route
 * unknowns to a default block instead.
 *
 * "Registered" means an **own** property of `blocks`. Every caller feeds
 * `select` a runtime-derived string — a model's chosen specialist or
 * speaker name, a task's `assignee` — so a key naming an inherited
 * `Object.prototype` member (`toString`, `constructor`, `valueOf`,
 * `__proto__`, …) is a reachable miss, not a theoretical one. Resolving
 * it off the prototype chain would hand the router a non-block, which
 * then fails the route-candidate check with a confusing "selected
 * invalid route" instead of taking the fallback (or raising the
 * registered-key error). See `tasks/collection/safe-key.ts` in
 * `@flow-state-dev/orchestration` for the same class guarded at the
 * key-owning layer.
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
  /**
   * String-keyed routing table. Keys are the values `select` returns.
   * Only **own** properties count as registered routes.
   */
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
      // Own-property lookup only — an inherited `Object.prototype` member is
      // not a registered route (see the file header).
      const selected = Object.prototype.hasOwnProperty.call(blocks, key)
        ? blocks[key]
        : undefined;
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
