import type { ZodTypeAny } from "zod";
import type { BlockConfig, BlockContext, BlockDefinition, ConnectorFn } from "../types/block";
import { buildBlock } from "./internal/build-block";

export interface HandlerConfig<TInput, TOutput> extends Omit<BlockConfig<TInput, TOutput>, "execute"> {
  requestStateSchema?: ZodTypeAny;
  sessionStateSchema?: ZodTypeAny;
  userStateSchema?: ZodTypeAny;
  projectStateSchema?: ZodTypeAny;
  requestResourcesSchema?: ZodTypeAny;
  sessionResourcesSchema?: ZodTypeAny;
  userResourcesSchema?: ZodTypeAny;
  projectResourcesSchema?: ZodTypeAny;
  connectInput?: ConnectorFn<unknown, TInput>;
  execute: (input: TInput, ctx: BlockContext) => Promise<TOutput> | TOutput;
}

export function handler<TInput, TOutput>(config: HandlerConfig<TInput, TOutput>): BlockDefinition<TInput, TOutput> {
  return buildBlock<TInput, TOutput>({
    kind: "handler",
    config,
    execute: config.execute
  });
}
