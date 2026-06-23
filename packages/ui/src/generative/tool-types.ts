/**
 * Tool-surface types for the generative UI pack. This is the server-side half
 * of the old fused `GenerativeComponent`: it carries the zod schema (the tool's
 * inputSchema) and the tool factory that returns a `handler` block. These types
 * live on the tools entrypoint, which is the only surface allowed to reach
 * `@flow-state-dev/core` and zod.
 */
import type { z, ZodTypeAny } from "zod";
import type { BlockDefinition } from "@flow-state-dev/core/types";

/**
 * Options for a component's tool factory. Keep this minimal — per-component
 * tools may extend it with their own options.
 */
export interface GenerativeToolOptions<TSchema extends ZodTypeAny> {
  /**
   * Map input → stable key used for component dedup/replacement. Defaults to a
   * per-component sensible field (typically `id` or `url`).
   */
  keyFrom?: (input: z.infer<TSchema>) => string;
}

/** A single entry on the tool surface: a name, its zod schema, and its factory. */
export interface GenerativeTool<TSchema extends ZodTypeAny> {
  /** Component name emitted by the tool; matches the renderer's `name`. */
  name: string;
  /** Zod schema. Serves as the tool's inputSchema and the renderer's data contract. */
  schema: TSchema;
  /**
   * Tool factory. Returns a `handler` block that, when invoked by the LLM,
   * emits a component item with the given data.
   */
  tool: (options?: GenerativeToolOptions<TSchema>) => BlockDefinition;
}
