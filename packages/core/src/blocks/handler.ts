import { z, type ZodTypeAny } from "zod";
import type { BlockConfig, BlockContext, BlockDefinition, ConnectorFn } from "../types/block";
import { buildBlock } from "./internal/build-block";

export interface HandlerConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
> extends Omit<BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>, "execute"> {
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

export function handler<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
>(config: HandlerConfig<TInputSchema, TOutputSchema>): BlockDefinition<TInputSchema, TOutputSchema> {
  return buildBlock<TInputSchema, TOutputSchema>({
    kind: "handler",
    config: config as unknown as BlockConfig<TInputSchema, TOutputSchema>,
    execute: config.execute
  });
}
