import { z, type ZodTypeAny } from "zod";
import type {
  AsToolOpts,
  BlockConfig,
  BlockContext,
  BlockDefinition,
  BlockKind,
  BlockRuntime,
  ConnectorFn,
  DeclaredResources
} from "../../types/block";
import type { GeneratorCompletedMeta } from "../generator";
import { asRuntime } from "../../types/block";
import type { DefinedResource } from "../../types/resource";
import type { DefinedResourceCollection } from "../../types/resource-collection";
import type { JsonObject } from "../../schema/common";
import type { CapabilityRef } from "../../capability/types";
import { toError } from "./utils";
import { emitToolOutputAround } from "./emit-tool-output";

/**
 * Extract resource declarations from a block config into a `DeclaredResources`
 * metadata object. Returns `undefined` when no resources are declared.
 *
 * The flat `resources` field is the canonical source under FIX-435; each
 * resource's intrinsic `scope` is what routes it to a storage layer at
 * registry-construction time.
 */
export function extractDeclaredResources(config: {
  resources?: Record<string, DefinedResource | DefinedResourceCollection<JsonObject>>;
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
  /**
   * This block's OWN declared resources — its own `resources` config plus its
   * own capability-injected resources, EXCLUDING resources that bubble up from
   * descendant/child blocks. For leaf blocks (handler/generator) this equals
   * `declaredResources`. For composites (sequencer/router) it is the strict
   * subset the block itself contributes. Used by the block-dispatch prefetch
   * hook (FIX-688) to load just this block's declarations.
   */
  ownDeclaredResources?: DeclaredResources;
  /** Resolved capabilities from `uses`, stored for ctx.cap construction at runtime. */
  resolvedCapabilities?: CapabilityRef[];
  /**
   * Pre-computed `requiresOrg` derived from child blocks. Sequencer/router
   * builders OR this with their own `config.requireOrg`. Leaves omit it.
   */
  requiresOrg?: boolean;
  /**
   * Mapper installed via `BlockDefinition.mapModelOutput`. Carried on the
   * runtime view; the generator tool bridge reads it via `asRuntime(tool)`
   * and forwards it to the AI SDK as `toModelOutput`.
   */
  modelOutputMapper?: (output: TOutput, ctx: BlockContext) => string | Promise<string>;
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

  const definition: BlockRuntime<TInputSchema, TOutputSchema, TInput, TOutput> = {
    kind,
    name: runtimeConfig.name,
    description: runtimeConfig.description,
    transient,
    inputSchema: resolvedInputSchema,
    outputSchema: resolvedOutputSchema,
    config: runtimeConfig,
    declaredResources: options.declaredResources,
    ownDeclaredResources: options.ownDeclaredResources,
    requiresOrg,
    _modelOutputMapper: options.modelOutputMapper,
    async run(rawInput: TInput, ctx: BlockContext): Promise<TOutput> {
      try {
        // FIX-688 Wave 3: load this block's OWN declared resources into the
        // per-scope cache before it runs, so single resources (eager or lazy)
        // read synchronously inside execute(). Lazy collections are skipped —
        // their async accessor fetches on demand. No-op when the runtime does
        // not provide the loader (mock/unit contexts).
        if (options.ownDeclaredResources !== undefined) {
          await ctx._loadDeclaredResources?.(options.ownDeclaredResources, {
            loadLazySingles: true
          });
        }

        // Fire the `added` phase trace hook before running connectInput. The
        // server constructs the in_progress block_trace item from this and
        // emits item.added — establishes the row that subsequent phases patch.
        const inputHint = (ctx as { _blockInputHint?: import("../../items/types").BlockValueInternal<unknown> })._blockInputHint;
        ctx._runtimeHooks?.onBlockTraceCapture?.(
          {
            phase: "added",
            data: {
              status: "in_progress",
              input: { source: inputHint ?? { kind: "inline", value: rawInput } },
              // Surface this block's own declared accessor keys so the server
              // can render declared-vs-loaded resource observability.
              declaredResources:
                options.ownDeclaredResources !== undefined
                  ? Object.keys(options.ownDeclaredResources)
                  : undefined,
              startedAt: Date.now()
            }
          },
          ctx
        );

        const connectedInput = runtimeConfig.connectInput
          ? await runtimeConfig.connectInput(rawInput, ctx)
          : rawInput;
        // Fire the `input` phase only when the connector actually transformed
        // the value — a no-op connector adds no information beyond the source
        // already captured at `added`.
        if (runtimeConfig.connectInput && connectedInput !== rawInput) {
          ctx._runtimeHooks?.onBlockTraceCapture?.(
            {
              phase: "input",
              data: {
                input: {
                  source: inputHint ?? { kind: "inline", value: rawInput },
                  connected: connectedInput
                }
              }
            },
            ctx
          );
        }
        const validatedInput = validateSchema<TInput>(runtimeConfig.inputSchema, connectedInput, "input", runtimeConfig.name);
        const output = await internalExecute(validatedInput, ctx);
        const validatedOutput = validateSchema<TOutput>(
          runtimeConfig.outputSchema,
          output,
          "output",
          runtimeConfig.name
        );

        if (runtimeConfig.onCompleted !== undefined) {
          const meta: GeneratorCompletedMeta | undefined =
            ctx._currentModelIdentity !== undefined ? { model: ctx._currentModelIdentity } : undefined;
          await (runtimeConfig.onCompleted as (
            output: TOutput,
            ctx: BlockContext,
            meta?: GeneratorCompletedMeta
          ) => Promise<void> | void)(validatedOutput, ctx, meta);
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
        execute: internalExecute as unknown as ExecuteFn<ZodTypeAny, TOutputSchema, unknown, TOutput>,
        declaredResources: definition.declaredResources,
        ownDeclaredResources: definition.ownDeclaredResources,
        resolvedCapabilities: options.resolvedCapabilities,
        requiresOrg: definition.requiresOrg,
        // `connectInput` preserves `TOutputSchema`, so any installed
        // `mapModelOutput` mapper is still valid against the rebuilt block's
        // output. Forward it through.
        modelOutputMapper: options.modelOutputMapper,
      });
    },
    mapModelOutput(
      mapper: (output: TOutput, ctx: BlockContext) => string | Promise<string>
    ): BlockDefinition<TInputSchema, TOutputSchema> {
      return buildBlock<TInputSchema, TOutputSchema, TInput, TOutput>({
        kind,
        config: runtimeConfig,
        execute: internalExecute,
        declaredResources: definition.declaredResources,
        ownDeclaredResources: definition.ownDeclaredResources,
        resolvedCapabilities: options.resolvedCapabilities,
        requiresOrg: definition.requiresOrg,
        modelOutputMapper: mapper,
      });
    },
    asTool(opts: AsToolOpts = {}): BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput> {
      const wrappedName = `${runtimeConfig.name}__as_tool`;
      // The wrapper's execute drives the `tool_output` envelope around an
      // inner `asRuntime(block).run(input, ctx)` call. The inner block sees a
      // `_blockOutputHint = { kind: "ref", sourceItemId }` so its
      // `block_trace.output` becomes a ref to the tool_output (matches the
      // AI-SDK tool-loop path; avoids devtool duplication).
      const wrappedExecute: ExecuteFn<TInputSchema, TOutputSchema, TInput, TOutput> = async (
        input,
        ctx
      ) => {
        const callId = `call_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const attribution = {
          callId,
          generatorBlock: ctx._blockIdentity?.blockName ?? definition.name,
          ...(opts.itemVisibility !== undefined ? { itemVisibility: opts.itemVisibility } : {}),
          ...(opts.agentName !== undefined ? { agentName: opts.agentName } : {}),
        };
        const hintRef = { kind: "ref" as const };
        const output = (await emitToolOutputAround(
          definition,
          ctx,
          input,
          attribution,
          async (outerCtx, toolOutputId) => {
            // `emitToolOutputAround` passes the outer ctx (no scope boundary
            // here, unlike the AI-SDK path which derives one via
            // `_withExecutionScope`). The inner block — especially a
            // generator/sequencer/router — may write its own
            // `_blockOutputHint` to the same ctx while it runs. Re-stamp the
            // tool_output ref after the inner returns so the outer executor
            // reads the wrapper's intended ref, not the inner's last write.
            const ctxAny = outerCtx as {
              _blockOutputHint?: { kind: "ref"; sourceItemId: string };
            };
            ctxAny._blockOutputHint = { ...hintRef, sourceItemId: toolOutputId };
            try {
              return await asRuntime(definition).run(input, outerCtx);
            } finally {
              ctxAny._blockOutputHint = { ...hintRef, sourceItemId: toolOutputId };
            }
          }
        )) as TOutput;
        return output;
      };

      // The wrapper is a transparent handler around the inner block's run.
      // Strip lifecycle hooks and connectInput so they fire only on the inner
      // block (via `asRuntime(definition).run` inside `runInner`), not twice.
      const wrappedConfig: BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput> = {
        name: wrappedName,
        description: runtimeConfig.description,
        inputSchema: runtimeConfig.inputSchema,
        outputSchema: runtimeConfig.outputSchema,
      };

      // declaredResources / resolvedCapabilities are forwarded so the inner
      // block's resource declarations still bubble up to the flow when the
      // wrapper is the surface added to a sequencer chain.
      return buildBlock<TInputSchema, TOutputSchema, TInput, TOutput>({
        kind: "handler",
        config: wrappedConfig,
        execute: wrappedExecute,
        declaredResources: definition.declaredResources,
        ownDeclaredResources: definition.ownDeclaredResources,
        resolvedCapabilities: options.resolvedCapabilities,
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

      // Intentionally do not forward `modelOutputMapper`: `connectOutput`
      // changes the output type from `TOutput` to `TTo`, so the original
      // mapper's `(output: TOutput) => string` signature no longer matches.
      // Re-install via `.mapModelOutput(...)` after `.connectOutput(...)` if
      // a model-visible representation is still wanted on the rebuilt block.
      return buildBlock<TInputSchema, ZodTypeAny, TInput, TTo>({
        kind,
        config: nextConfig,
        execute: mappedExecute,
        declaredResources: definition.declaredResources,
        ownDeclaredResources: definition.ownDeclaredResources,
        resolvedCapabilities: options.resolvedCapabilities,
        requiresOrg: definition.requiresOrg,
      });
    }
  };

  return definition;
}
