/**
 * Info-card bundle. Schema + renderer + tool factory shipped together so a
 * generator can emit the shape and a FlowProvider can render it without any
 * adapter layer between them.
 */
import type { GenerativeComponent } from "../types";
import { InfoCardRenderer } from "./renderer";
import { InfoCardSchema } from "./schema";
import { emitInfoCardTool } from "./tool";

export const infoCard: GenerativeComponent<typeof InfoCardSchema> = {
  name: "info-card",
  schema: InfoCardSchema,
  Renderer: InfoCardRenderer,
  tool: emitInfoCardTool,
};

export { InfoCardSchema, type InfoCardData } from "./schema";
export { InfoCardRenderer } from "./renderer";
export { emitInfoCardTool } from "./tool";
