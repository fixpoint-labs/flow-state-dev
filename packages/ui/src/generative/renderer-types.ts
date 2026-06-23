/**
 * Renderer-surface type for the generative UI pack. This is the browser-side
 * half of the old fused `GenerativeComponent`: it ties a component name to its
 * React renderer and nothing else. It references only `ComponentItem` from the
 * zero-dependency `@flow-state-dev/contracts` layer and React — no zod, no
 * `@flow-state-dev/core` — so the renderer entrypoint stays browser-light.
 */
import type { ComponentType } from "react";
import type { ComponentItem } from "@flow-state-dev/contracts";

/** A single entry on the renderer surface: a component name and its renderer. */
export interface GenerativeRenderer {
  /** Component name registered with FlowProvider; matches the tool's `name`. */
  name: string;
  /**
   * React renderer. Receives the full `ComponentItem`; the schema-typed data
   * lives at `item.data`. The renderer only `import type`s its `*Data` shape,
   * so no zod value reaches the browser bundle.
   */
  Renderer: ComponentType<{ item: ComponentItem }>;
}
