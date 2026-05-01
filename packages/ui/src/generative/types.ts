/**
 * Generative UI bundle type — the unit shipped per rendering shape.
 *
 * A `GenerativeComponent` ties together three things that travel as a unit:
 *  - a Zod schema (used as both the tool's inputSchema and the renderer's data contract)
 *  - a React renderer (consumes the schema-typed data)
 *  - a tool factory (returns a handler block that emits the component)
 *
 * Generators load the tool factories; FlowProvider loads the renderers. The same
 * shape (`name`, `schema`) bridges both surfaces.
 */
import type { z, ZodTypeAny } from "zod";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import type { ComponentItem } from "@flow-state-dev/core/items";
import type { ComponentType } from "react";

/** Options for tool factories. Keep this minimal — per-component tools may
 *  extend with their own options. */
export interface GenerativeToolOptions<TSchema extends ZodTypeAny> {
  /** Map input → stable key used for component dedup/replacement.
   *  Defaults to a per-component sensible field (typically `id`). */
  keyFrom?: (input: z.infer<TSchema>) => string;
}

export interface GenerativeComponent<TSchema extends ZodTypeAny> {
  /** Component name registered with FlowProvider — also the value passed to
   *  ctx.emitComponent. Stable, kebab-case. */
  name: string;
  /** Zod schema. Same instance serves as tool inputSchema AND renderer data contract. */
  schema: TSchema;
  /** React renderer. Receives the full ComponentItem; data lives at item.data
   *  and matches z.infer<TSchema>. */
  Renderer: ComponentType<{ item: ComponentItem }>;
  /** Tool factory. Returns a handler block that, when invoked by the LLM,
   *  emits a component item with the given data. */
  tool: (options?: GenerativeToolOptions<TSchema>) => BlockDefinition;
}
