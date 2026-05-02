import { z, type ZodTypeAny } from "zod";
import type {
  BlockConfig,
  BlockContext,
  BlockDefinition,
  BlockKind,
  BlockRuntime,
  ConnectorFn,
  DeclaredResources
} from "../../types/block";
import { BlockNestingError, INSIDE_EXECUTE } from "../../types/block";
import type { DefinedResource } from "../../types/resource";
import type { DefinedResourceCollection } from "../../types/resource-collection";
import type { CapabilityRef } from "../../capability/types";
import { toError } from "./utils";

/**
 * Extract resource declarations from a block config into a `DeclaredResources`
 * metadata object. Returns `undefined` when no resources are declared.
 *
 * The flat `resources` field is the canonical source under FIX-435; each
 * resource's intrinsic `scope` is what routes it to a storage layer at
 * registry-construction time.
 */
export function extractDeclaredResources(config: {
  resources?: Record<string, DefinedResource | DefinedResourceCollection>;
}): DeclaredResources | undefined {
  if (config.resources === undefined || Object.keys(config.resources).length === 0) {
    return undefined;
  }
  return { ...config.resources };
}

/**
 * Merge two flat `DeclaredResources` objects. Same accessor key + same
 * `defineResource()` reference deduplicates; same accessor key with a
 * different reference is a build-time error.
 *
 * Effective-storage-key collisions (different accessor keys pointing at the
 * same `(scope, ref, flowIsolation)`) are detected at flow-build time, not
 * here — this layer only merges the bubble-up sets.
 */
export function mergeDeclaredResources(
  target: DeclaredResources | undefined,
  source: DeclaredResources | undefined
): DeclaredResources | undefined {
  if (source === undefined) return target;
  if (target === undefined) return { ...source };

  for (const [name, resource] of Object.entries(source)) {
    const existing = target[name];
    if (existing === undefined) {
      target[name] = resource;
      continue;
    }
    if (existing === resource) continue;
    throw new Error(
      `Resource conflict: "${name}" is declared with different defineResource() references. Use the same reference across blocks, or pick distinct accessor keys.`
    );
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
  /** Resolved capabilities from `uses`, stored for ctx.cap construction at runtime. */
  resolvedCapabilities?: CapabilityRef[];
  /**
   * Pre-computed `requiresOrg` derived from child blocks. Sequencer/router
   * builders OR this with their own `config.requireOrg`. Leaves omit it.
   */
  requiresOrg?: boolean;
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
>(options: BuildBlockOptions<TInputSchema, TOutputSchema>): BlockRuntime<TInputSchema, TOutputSchema, TInput, TOutput> {
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

  // Store resolved capabilities for ctx.cap construction at runtime.
  if (options.resolvedCapabilities && options.resolvedCapabilities.length > 0) {
    (runtimeConfig as any).__resolvedCapabilities = options.resolvedCapabilities;
  }

  const transient = config.transient === true;

  // Bubble: a block requires org if it declares `requireOrg: true` or any
  // descendant requires it (sequencer/router builders pass children's
  // aggregate as `options.requiresOrg`).
  const requiresOrg = Boolean(config.requireOrg) || Boolean(options.requiresOrg);

  // Runtime guard for BP-011 (FIX-503). For handler kind, the user's
  // `execute` runs against a per-call ctx wrapper that carries the
  // `INSIDE_EXECUTE` symbol. Wrapping rather than mutating keeps
  // concurrent sibling branches isolated — they each get their own
  // wrapper and never observe each other's flag.
  // Substrate orchestration (sequencer/router/generator) doesn't wrap,
  // so chained sibling `_run` calls between substrate and child blocks
  // pass through naturally.
  const stampsInsideExecute = kind === "handler";

  const dispatch = async (rawInput: TInput, ctx: BlockContext): Promise<TOutput> => {
    try {
      const connectedInput = runtimeConfig.connectInput
        ? await runtimeConfig.connectInput(rawInput, ctx)
        : rawInput;
      // Fire the runtime hook only when the connector actually transformed
      // the value. Identity check avoids spurious debug items when the
      // connector is a no-op passthrough.
      if (runtimeConfig.connectInput && connectedInput !== rawInput) {
        ctx._runtimeHooks?.onConnectedInput?.(connectedInput, ctx);
      }
      const validatedInput = validateSchema<TInput>(runtimeConfig.inputSchema, connectedInput, "input", runtimeConfig.name);
      let output: TOutput;
      if (stampsInsideExecute) {
        // Per-call wrapper carrying the BP-011 flag. Reads delegate to the
        // shared ctx; only the symbol lives on the wrapper, so siblings
        // running concurrently against the same parent ctx don't bleed
        // their flags into each other.
        const wrappedCtx = Object.create(ctx) as BlockContext;
        (wrappedCtx as unknown as Record<symbol, unknown>)[INSIDE_EXECUTE] = true;
        output = await internalExecute(validatedInput, wrappedCtx);
      } else {
        output = await internalExecute(validatedInput, ctx);
      }
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
  };

  const definition: BlockRuntime<TInputSchema, TOutputSchema, TInput, TOutput> = {
    kind,
    name: runtimeConfig.name,
    description: runtimeConfig.description,
    transient,
    inputSchema: resolvedInputSchema,
    outputSchema: resolvedOutputSchema,
    config: runtimeConfig,
    declaredResources: options.declaredResources,
    requiresOrg,
    async _run(rawInput: TInput, ctx: BlockContext): Promise<TOutput> {
      const ctxBag = ctx as unknown as Record<symbol, unknown>;
      if (ctxBag[INSIDE_EXECUTE] === true) {
        // Identify the outer block via _blockIdentity for a useful error message.
        const outer = (ctx as { _blockIdentity?: { blockName?: string } })._blockIdentity?.blockName;
        throw new BlockNestingError(runtimeConfig.name, outer);
      }
      return dispatch(rawInput, ctx);
    },
    async _runUnchecked(rawInput: TInput, ctx: BlockContext): Promise<TOutput> {
      // Substrate-only escape (FIX-503). Bypasses the BP-011 nesting guard
      // for first-party utilities whose composition cannot be expressed via
      // sibling sequencer steps. Every caller MUST document why.
      //
      // Wrap the ctx with the `INSIDE_EXECUTE` flag explicitly cleared so
      // the called block's own internals (sequencer steps, router routes,
      // generator tools) don't inherit the caller's flag and trip the
      // guard. Without this, calling a compound block (sequencer/router/
      // generator-with-tools) via `_runUnchecked` from inside a handler
      // would throw `BlockNestingError` at the first child dispatch.
      const cleared = Object.create(ctx) as BlockContext;
      (cleared as unknown as Record<symbol, unknown>)[INSIDE_EXECUTE] = false;
      return dispatch(rawInput, cleared);
    },
    connectInput<TFrom>(mapper: ConnectorFn<TFrom, TInput>): BlockDefinition<ZodTypeAny, TOutputSchema> {
      const nextConfig = {
        ...(runtimeConfig as unknown as BlockConfig<ZodTypeAny, TOutputSchema, unknown, TOutput>),
        connectInput: mapper as unknown as ConnectorFn<unknown, unknown>
      };

      return buildBlock<ZodTypeAny, TOutputSchema, unknown, TOutput>({
        kind,
        config: nextConfig,
        execute: internalExecute as unknown as ExecuteFn<ZodTypeAny, TOutputSchema, unknown, TOutput>,
        declaredResources: definition.declaredResources,
        requiresOrg: definition.requiresOrg,
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
        execute: mappedExecute,
        declaredResources: definition.declaredResources,
        requiresOrg: definition.requiresOrg,
      });
    }
  };

  return definition;
}
