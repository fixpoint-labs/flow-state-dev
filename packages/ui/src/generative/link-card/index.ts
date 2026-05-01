/**
 * Link-card bundle. Schema + renderer + tool factory for rich URL previews.
 */
import type { GenerativeComponent } from "../types";
import { LinkCardRenderer } from "./renderer";
import { LinkCardSchema } from "./schema";
import { emitLinkCardTool } from "./tool";

export const linkCard: GenerativeComponent<typeof LinkCardSchema> = {
  name: "link-card",
  schema: LinkCardSchema,
  Renderer: LinkCardRenderer,
  tool: emitLinkCardTool,
};

export { LinkCardSchema, type LinkCardData } from "./schema";
export { LinkCardRenderer } from "./renderer";
export { emitLinkCardTool } from "./tool";
