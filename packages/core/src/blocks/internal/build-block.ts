import { z, type ZodTypeAny } from "zod";
import type {
  BlockConfig,
  BlockContext,
  BlockDefinition,
  BlockKind,
  ConnectorFn,
  DeclaredResources
} from "../../types/block";
import type { DefinedResource } from "../../types/resource";
import { toError } from "./utils";

/**
 * Extract resource declarations from a block config into a `DeclaredResources`
 * metadata object. Returns `undefined` when no resources are declared.
 */
export function extractDeclaredResources(config: {
  sessionResources?: Record<string, DefinedResource>;
  userResources?: Record<string, DefinedResource>;
  projectResources?: Record<string, DefinedResource>;
}): DeclaredResources | undefined {
  const result: DeclaredResources = {};
  if (config.sessionResources) result.session = config.sessionResources;
  if (config.userResources) result.user = config.userResources;
  if (config.projectResources) result.project = config.projectResources;
  return Object.keys(result).length > 0 ? result : undefined;
}

type ResourceScope = "session" | "user" | "project";

/**
 * Merge a scope-level resource map from `source` into `target`.
 * Same `DefinedResource` reference → no conflict.
 * Different references → build-time error.
 */
function mergeScopeResources(
  target: Record<string, DefinedResource>,
  source: Record<string, DefinedResource>,
  scope: ResourceScope
): void {
  for (const [name, resource] of Object.entries(source)) {
    const existing = target[name];
    if (existing === undefined) {
      target[name] = resource;
      continue;
    }

    // Same reference — no conflict
    if (existing === resource) {
      continue;
    }

    throw new Error(
      `Resource conflict: "${name}" in ${scope} scope is declared with different defineResource() references. Use the same reference across blocks.`
    );
  }
}

/**
 * Merge two `DeclaredResources` objects. Mutates `target` in place and returns it.
 * Returns `undefined` when both inputs are undefined.
 */
export function mergeDeclaredResources(
  target: DeclaredResources | undefined,
  source: DeclaredResources | undefined
): DeclaredResources | undefined {
  if (source === undefined) return target;
  if (target === undefined) return { ...source };

  const scopes: ResourceScope[] = ["session", "user", "project"];
  for (const scope of scopes) {
    const sourceScope = source[scope];
    if (sourceScope === undefined) continue;
    if (target[scope] === undefined) {
      target[scope] = { ...sourceScope };
    } else {
      mergeScopeResources(target[scope]!, sourceScope, scope);
    }
  }

  return target;
}

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
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
> = {
  kind: BlockKind;
  config: BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>;
  execute?: ExecuteFn<TInputSchema, TOutputSchema, TInput, TOutput>;
  declaredResources?: DeclaredResources;
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
    description: runtimeConfig.description,
    inputSchema: resolvedInputSchema,
    outputSchema: resolvedOutputSchema,
    config: runtimeConfig,
    declaredResources: options.declaredResources,
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
        ...(runtimeConfig as unknown as BlockConfig<ZodTypeAny, TOutputSchema, unknown, TOutput>),
        connectInput: mapper as unknown as ConnectorFn<unknown, unknown>
      };

      return buildBlock<ZodTypeAny, TOutputSchema, unknown, TOutput>({
        kind,
        config: nextConfig,
        execute: internalExecute as unknown as ExecuteFn<ZodTypeAny, TOutputSchema, unknown, TOutput>
      });
    },
    connectOutput<TTo>(
      mapper: (output: TOutput, ctx: BlockContext) => TTo | Promise<TTo>
    ): BlockDefinition<TInputSchema, ZodTypeAny> {
      const mappedExecute: ExecuteFn<TInputSchema, ZodTypeAny, TInput, TTo> = async (input, ctx) => {
        const output = await internalExecute(input, ctx);
        return mapper(output as TOutput, ctx);
      };

      const nextConfig: BlockConfig<TInputSchema, ZodTypeAny, TInput, TTo> = {
        ...(runtimeConfig as unknown as BlockConfig<TInputSchema, ZodTypeAny, TInput, TTo>),
        outputSchema: z.any() as ZodTypeAny,
        onCompleted: undefined
      };

      return buildBlock<TInputSchema, ZodTypeAny, TInput, TTo>({
        kind,
        config: nextConfig,
        execute: mappedExecute
      });
    }
  };

  return definition;
}
