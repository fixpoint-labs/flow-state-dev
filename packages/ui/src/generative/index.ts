/**
 * Aggregator for the generative UI starter pack.
 *
 * Three-line developer experience:
 *
 *   // server-side, in a generator definition
 *   tools: [...generativeUI.tools(), ...otherTools],
 *
 *   // client-side, on the FlowProvider
 *   renderers={{ component: generativeUI.renderers() }}
 *
 * Use `.pick(...names)` to ship a tighter palette — fewer tools generally yields
 * better tool-selection accuracy on smaller models.
 *
 * Phase 1 ships info-card and link-card. Subsequent phases extend STARTER_PACK
 * with map-view, itinerary, dual-column, metric-grid, and choice-list.
 */
import type { ComponentType } from "react";
import type { ComponentItem } from "@flow-state-dev/core/items";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import type { GenerativeComponent } from "./types";
import { infoCard } from "./info-card";
import { linkCard } from "./link-card";

const STARTER_PACK: ReadonlyArray<GenerativeComponent<any>> = [infoCard, linkCard];

type RendererRegistry = Record<string, ComponentType<{ item: ComponentItem }>>;

function tools(set: ReadonlyArray<GenerativeComponent<any>>): BlockDefinition[] {
  return set.map((c) => c.tool());
}

function renderers(set: ReadonlyArray<GenerativeComponent<any>>): RendererRegistry {
  return Object.fromEntries(set.map((c) => [c.name, c.Renderer]));
}

export const generativeUI = {
  /** All starter-pack components in their canonical order. */
  components: STARTER_PACK,
  /** Tool factories ready to drop into a generator's `tools` array. */
  tools: () => tools(STARTER_PACK),
  /** Renderer registry ready to drop into FlowProvider's
   *  `renderers={{ component: ... }}` slot. */
  renderers: () => renderers(STARTER_PACK),
  /** Pick a subset by component name. Returns the same `.tools()` /
   *  `.renderers()` surface scoped to the picked components. Unknown names
   *  are silently ignored — caller-side typos are caught by linting tools, not
   *  this function. */
  pick: (...names: string[]) => {
    const set = STARTER_PACK.filter((c) => names.includes(c.name));
    return {
      components: set,
      tools: () => tools(set),
      renderers: () => renderers(set),
    };
  },
};

export type { GenerativeComponent, GenerativeToolOptions } from "./types";
export { infoCard } from "./info-card";
export { linkCard } from "./link-card";
export {
  InfoCardSchema,
  type InfoCardData,
  InfoCardRenderer,
  emitInfoCardTool,
} from "./info-card";
export {
  LinkCardSchema,
  type LinkCardData,
  LinkCardRenderer,
  emitLinkCardTool,
} from "./link-card";
