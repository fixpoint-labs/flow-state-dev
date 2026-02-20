import { z, type ZodTypeAny } from "zod";
import type { BlockConfig, BlockContext, BlockDefinition, ConnectorFn } from "../types/block";
import { buildBlock } from "./internal/build-block";

export interface HandlerConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> extends Omit<BlockConfig<TInputSchema, TOutputSchema>, "execute"> {
  requestStateSchema?: ZodTypeAny;
  sessionStateSchema?: ZodTypeAny;
  userStateSchema?: ZodTypeAny;
  projectStateSchema?: ZodTypeAny;
  requestResourcesSchema?: ZodTypeAny;
  sessionResourcesSchema?: ZodTypeAny;
  userResourcesSchema?: ZodTypeAny;
  projectResourcesSchema?: ZodTypeAny;
  connectInput?: ConnectorFn<unknown, z.infer<TInputSchema>>;
  execute: (input: z.infer<TInputSchema>, ctx: BlockContext) => Promise<z.infer<TOutputSchema>> | z.infer<TOutputSchema>;
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
