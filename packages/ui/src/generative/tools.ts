/**
 * Tool surface for the generative UI starter pack — the **server** entrypoint
 * (`@flow-state-dev/ui/generative/tools`).
 *
 * This aggregator carries the `handler`-based tool factories and their zod
 * schemas, so it (and only it) value-imports `@flow-state-dev/core`. Keep it
 * out of browser bundles — pair it with `generative/renderers` on the client.
 *
 *   // flow.ts (server)
 *   import { generativeTools } from "@flow-state-dev/ui/generative/tools";
 *   const gen = generator({ …, tools: [...generativeTools(), webSearch] });
 *
 * Use `.pick(...names)` to ship a tighter palette — fewer tools generally
 * yields better tool-selection accuracy on smaller models.
 */
import type { BlockDefinition } from "@flow-state-dev/core/types";
import type { GenerativeTool } from "./tool-types";
import { InfoCardSchema } from "./info-card/schema";
import { emitInfoCardTool } from "./info-card/tool";
import { LinkCardSchema } from "./link-card/schema";
import { emitLinkCardTool } from "./link-card/tool";

const STARTER_TOOLS: ReadonlyArray<GenerativeTool<any>> = [
  { name: "info-card", schema: InfoCardSchema, tool: emitInfoCardTool },
  { name: "link-card", schema: LinkCardSchema, tool: emitLinkCardTool },
];

function toBlocks(set: ReadonlyArray<GenerativeTool<any>>): BlockDefinition[] {
  return set.map((t) => t.tool());
}

/**
 * The starter-pack tool factories, ready to spread into a generator's `tools`
 * array. `generativeTools.pick(...names)` returns the same `BlockDefinition[]`
 * scoped to the named components; unknown names are silently ignored.
 */
export const generativeTools: (() => BlockDefinition[]) & {
  pick: (...names: string[]) => BlockDefinition[];
} = Object.assign(() => toBlocks(STARTER_TOOLS), {
  pick: (...names: string[]): BlockDefinition[] =>
    toBlocks(STARTER_TOOLS.filter((t) => names.includes(t.name))),
});

export type { GenerativeTool, GenerativeToolOptions } from "./tool-types";
export { InfoCardSchema, type InfoCardData } from "./info-card/schema";
export { emitInfoCardTool } from "./info-card/tool";
export { LinkCardSchema, type LinkCardData } from "./link-card/schema";
export { emitLinkCardTool } from "./link-card/tool";
