import { z, type ZodTypeAny } from "zod";
import type {
  BlockConfig,
  BlockContext,
  BlockDefinition,
  BlockKind,
  ConnectorFn
} from "../../types/block";
import { toError } from "./utils";

type ExecuteFn<
  TInputSchema extends ZodTypeAny,
  TOutputSchema extends ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
> = (
  input: TInput,
  ctx: BlockContext
) => Promise<TOutput> | TOutput;

export type BuildBlockOptions<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> = {
  kind: BlockKind;
  config: BlockConfig<TInputSchema, TOutputSchema>;
  execute?: ExecuteFn<TInputSchema, TOutputSchema>;
};

function validateSchema<TValue>(
  schema: ZodTypeAny | undefined,
  value: unknown,
  kind: "input" | "output",
  blockName: string
): TValue {
  if (schema === undefined) {
    return value as TValue;
  }

  const result = schema.safeParse(value);
  if (result.success) {
    return result.data as TValue;
  }

  const issue = result.error.issues[0];
  const issuePath = issue === undefined ? "" : issue.path.join(".");
  const issueMessage = issue === undefined ? "schema validation failed" : issue.message;
  const pathSuffix = issuePath.length > 0 ? ` at "${issuePath}"` : "";
  throw new Error(`Block "${blockName}" ${kind} validation failed${pathSuffix}: ${issueMessage}`);
}

function preserveNonFunctionOption<TValue>(value: TValue): TValue | undefined {
  if (typeof value === "function") {
    return undefined;
  }

  return value;
}

export function buildBlock<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
>(options: BuildBlockOptions<TInputSchema, TOutputSchema>): BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput> {
  const { kind, config } = options;
  const internalExecute = options.execute ?? config.execute;

  if (typeof config.name !== "string" || config.name.trim().length === 0) {
    throw new Error(`Cannot build "${kind}" block without a non-empty "name"`);
  }

  if (internalExecute === undefined) {
    throw new Error(`Cannot build "${config.name}" (${kind}) without an execute function`);
  }

  const resolvedInputSchema = (config.inputSchema ?? z.any()) as TInputSchema;
  const resolvedOutputSchema = (config.outputSchema ?? z.any()) as TOutputSchema;

  const runtimeConfig: BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput> = {
    ...config,
    inputSchema: resolvedInputSchema,
    outputSchema: resolvedOutputSchema
  };

  const definition: BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput> = {
    kind,
    name: runtimeConfig.name,
    renderKey: runtimeConfig.renderKey,
    description: runtimeConfig.description,
    inputSchema: resolvedInputSchema,
    outputSchema: resolvedOutputSchema,
    config: runtimeConfig,
    async run(rawInput: TInput, ctx: BlockContext): Promise<TOutput> {
      try {
        const connectedInput = runtimeConfig.connectInput
          ? await runtimeConfig.connectInput(rawInput, ctx)
          : rawInput;
        const validatedInput = validateSchema<TInput>(runtimeConfig.inputSchema, connectedInput, "input", runtimeConfig.name);
        const output = await internalExecute(validatedInput, ctx);
        const validatedOutput = validateSchema<TOutput>(
          runtimeConfig.outputSchema,
          output,
          "output",
          runtimeConfig.name
        );

        if (runtimeConfig.onCompleted !== undefined) {
          await runtimeConfig.onCompleted(validatedOutput, ctx);
        }

        return validatedOutput;
      } catch (error) {
        const normalizedError = toError(error);
        if (runtimeConfig.onErrored !== undefined) {
          try {
            await runtimeConfig.onErrored(normalizedError, ctx);
          } catch {
            // Preserve the original block failure and do not mask it with hook errors.
          }
        }

        throw normalizedError;
      }
    },
    connectInput<TFrom>(mapper: ConnectorFn<TFrom, TInput>): BlockDefinition<ZodTypeAny, TOutputSchema> {
      const nextConfig = {
        ...(runtimeConfig as unknown as BlockConfig<ZodTypeAny, TOutputSchema>),
        connectInput: mapper as unknown as ConnectorFn<unknown, unknown>
      };

      return buildBlock<ZodTypeAny, TOutputSchema>({
        kind,
        config: nextConfig,
        execute: internalExecute as unknown as ExecuteFn<ZodTypeAny, TOutputSchema>
      });
    },
    connectOutput<TTo>(
      mapper: (output: TOutput, ctx: BlockContext) => TTo | Promise<TTo>
    ): BlockDefinition<TInputSchema, ZodTypeAny> {
      const mappedExecute: ExecuteFn<TInputSchema, ZodTypeAny> = async (input, ctx) => {
        const output = await internalExecute(input, ctx);
        return mapper(output as TOutput, ctx);
      };

      const nextConfig: BlockConfig<TInputSchema, ZodTypeAny> = {
        ...(runtimeConfig as unknown as BlockConfig<TInputSchema, ZodTypeAny>),
        outputSchema: z.any() as ZodTypeAny,
        clientOutput: preserveNonFunctionOption(runtimeConfig.clientOutput) as BlockConfig<
          TInputSchema,
          ZodTypeAny
        >["clientOutput"],
        llmOutput: preserveNonFunctionOption(runtimeConfig.llmOutput) as BlockConfig<
          TInputSchema,
          ZodTypeAny
        >["llmOutput"],
        onCompleted: undefined
      };

      return buildBlock<TInputSchema, ZodTypeAny>({
        kind,
        config: nextConfig,
        execute: mappedExecute
      });
    }
  };

  return definition;
}
