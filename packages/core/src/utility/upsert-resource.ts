import { z, type ZodTypeAny } from "zod";
import type { BlockContext } from "../types/block";
import type { ResourceCollectionRef } from "../types/resource-collection";
import { handler } from "../blocks/handler";
import type { ScopeType } from "../types/scope";

export interface UpsertResourceConfig<TInputSchema extends ZodTypeAny> {
  /** Block name. */
  name: string;
  description?: string;
  inputSchema: TInputSchema;
  /** Resources this block needs registered on its scope. */
  projectResources?: Record<string, any>;
  /** Resources this block needs registered on its scope. */
  userResources?: Record<string, any>;
  /** Resources this block needs registered on its scope. */
  sessionResources?: Record<string, any>;
  /** State schema of the outer sequencer, if the block needs to read/write sequencer state. */
  sequencerStateSchema?: ZodTypeAny;
  collectionKey: string;
  scope?: ScopeType;
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
 * values, and optionally write binary/text content. Returns the original
 * input unchanged so the sequencer chain can continue with it.
 */
export function upsertResource<TInputSchema extends ZodTypeAny>(
  config: UpsertResourceConfig<TInputSchema>
) {
  type TInput = z.infer<TInputSchema>;

  return handler({
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    projectResources: config.projectResources,
    userResources: config.userResources,
    sessionResources: config.sessionResources,
    sequencerStateSchema: config.sequencerStateSchema,
    execute: async (input: TInput, ctx) => {
      const collection = (ctx[config.scope ?? "session"] as any).resources[config.collectionKey] as ResourceCollectionRef<any>;
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
