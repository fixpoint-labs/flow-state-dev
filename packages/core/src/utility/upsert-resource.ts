import { z, type ZodTypeAny } from "zod";
import type { BlockContext, DeclaredResourceEntry } from "../types/block";
import type { ResourceCollectionRef } from "../types/resource-collection";
import { handler } from "../blocks/handler";

export interface UpsertResourceConfig<TInputSchema extends ZodTypeAny> {
  /** Block name. */
  name: string;
  description?: string;
  inputSchema: TInputSchema;
  /** Flat resource declarations the block needs registered (FIX-435). */
  resources?: Record<string, DeclaredResourceEntry>;
  /** State schema of the outer sequencer, if the block needs to read/write sequencer state. */
  sequencerStateSchema?: ZodTypeAny;
  /**
   * Accessor key into `ctx.resources` pointing at the target collection. The
   * collection's intrinsic scope and ref decide where its instances persist.
   */
  collectionKey: string;
  /** Derive the resource key from input. */
  key: (input: z.infer<TInputSchema>) => string;
  /** Derive state to create/patch from input. */
  state: (input: z.infer<TInputSchema>, ctx: BlockContext) => Record<string, unknown>;
  /** Optional: content to write after upsert. */
  content?: (input: z.infer<TInputSchema>) => string | undefined;
}

/**
 * Factory that returns a handler block performing a resource upsert:
 * get-or-create the resource instance, patch its state with the latest
 * values, and optionally write binary/text content. Returns no value so the
 * sequencer chain can pass through the original input unchanged.
 */
export function upsertResource<TInputSchema extends ZodTypeAny>(
  config: UpsertResourceConfig<TInputSchema>
) {
  type TInput = z.infer<TInputSchema>;

  return handler({
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    resources: config.resources,
    sequencerStateSchema: config.sequencerStateSchema,
    execute: async (input: TInput, ctx) => {
      const collection = ctx.resources[config.collectionKey] as unknown as ResourceCollectionRef<any>;
      const key = config.key(input);
      const state = config.state(input, ctx as any);
      const content = config.content?.(input);

      // getOrCreate sets initial state only on creation; always patchState
      // afterwards so updates are applied whether the resource is new or existing.
      const ref = await collection.getOrCreate(key, state as any);
      await ref.patchState(state as any);
      if (content !== undefined) {
        await ref.writeContent(content);
      }
    },
  });
}
