/**
 * Renderer surface for the generative UI starter pack — the **browser**
 * entrypoint (`@flow-state-dev/ui/generative/renderers`).
 *
 * This aggregator imports each component's `renderer` module directly and
 * never the fused component barrel, so the browser module graph provably
 * excludes the `handler`-based tool factories (and therefore `@flow-state-dev/core`
 * and zod). A renderer-surface guard test enforces that property.
 *
 *   // app.tsx (browser)
 *   import { generativeRenderers } from "@flow-state-dev/ui/generative/renderers";
 *   <FlowProvider renderers={{ component: generativeRenderers() }}>…</FlowProvider>
 *
 * Use `.pick(...names)` to register a subset.
 *
 * Phase 1 ships info-card and link-card. Subsequent phases extend
 * STARTER_RENDERERS with map-view, itinerary, dual-column, metric-grid, and
 * choice-list.
 */
import type { ComponentType } from "react";
import type { ComponentItem } from "@flow-state-dev/contracts";
import type { GenerativeRenderer } from "./renderer-types";
import { InfoCardRenderer } from "./info-card/renderer";
import { LinkCardRenderer } from "./link-card/renderer";

const STARTER_RENDERERS: readonly GenerativeRenderer[] = [
  { name: "info-card", Renderer: InfoCardRenderer },
  { name: "link-card", Renderer: LinkCardRenderer },
];

/** Registry shape consumed by FlowProvider's `renderers={{ component: ... }}` slot. */
export type RendererRegistry = Record<string, ComponentType<{ item: ComponentItem }>>;

function toRegistry(set: readonly GenerativeRenderer[]): RendererRegistry {
  return Object.fromEntries(set.map((r) => [r.name, r.Renderer]));
}

/**
 * The starter-pack renderer registry, ready to drop into FlowProvider's
 * `renderers={{ component: ... }}` slot. `generativeRenderers.pick(...names)`
 * returns the same registry scoped to the named components; unknown names are
 * silently ignored.
 */
export const generativeRenderers: (() => RendererRegistry) & {
  pick: (...names: string[]) => RendererRegistry;
} = Object.assign(() => toRegistry(STARTER_RENDERERS), {
  pick: (...names: string[]): RendererRegistry =>
    toRegistry(STARTER_RENDERERS.filter((r) => names.includes(r.name))),
});

export type { GenerativeRenderer } from "./renderer-types";
export { InfoCardRenderer } from "./info-card/renderer";
export { LinkCardRenderer } from "./link-card/renderer";
