import type { ZodTypeAny } from "zod";
import type {
  BlockConfig,
  BlockContext,
  BlockDefinition,
  ConnectorFn
} from "../types/block";
import { buildBlock } from "./internal/build-block";

function isRouteInCandidates<TInput, TOutput>(
  candidate: BlockDefinition<TInput, TOutput>,
  routes: BlockDefinition<TInput, TOutput>[]
): boolean {
  return routes.some((route) => route === candidate || route.name === candidate.name);
}

export interface RouterConfig<TInput, TOutput> extends Omit<BlockConfig<TInput, TOutput>, "execute"> {
  requestStateSchema?: ZodTypeAny;
  sessionStateSchema?: ZodTypeAny;
  userStateSchema?: ZodTypeAny;
  projectStateSchema?: ZodTypeAny;
  requestResourcesSchema?: ZodTypeAny;
  sessionResourcesSchema?: ZodTypeAny;
  userResourcesSchema?: ZodTypeAny;
  projectResourcesSchema?: ZodTypeAny;
  connectInput?: ConnectorFn<unknown, TInput>;
  routes: BlockDefinition<TInput, TOutput>[];
  execute: (
    input: TInput,
    ctx: BlockContext
  ) => Promise<BlockDefinition<TInput, TOutput>> | BlockDefinition<TInput, TOutput>;
  validateRoute?: (
    candidate: BlockDefinition<TInput, TOutput>,
    routes: BlockDefinition<TInput, TOutput>[],
    input: TInput,
    ctx: BlockContext
  ) => Promise<boolean> | boolean;
}

export function router<TInput, TOutput>(config: RouterConfig<TInput, TOutput>): BlockDefinition<TInput, TOutput> {
  return buildBlock<TInput, TOutput>({
    kind: "router",
    config,
    execute: async (input, ctx) => {
      const selected = await config.execute(input, ctx);
      const passesValidation =
        config.validateRoute === undefined
          ? isRouteInCandidates(selected, config.routes)
          : await config.validateRoute(selected, config.routes, input, ctx);

      if (!passesValidation) {
        throw new Error(
          `Router "${config.name}" selected invalid route "${selected.name}". Route must be one of declared candidates.`
        );
      }

      if (selected.config.execute === undefined) {
        throw new Error(`Router "${config.name}" selected route "${selected.name}" without an execute function`);
      }

      return selected.config.execute(input, ctx);
    }
  });
}
