/**
 * Info-card tool factory. Produces a `handler` block that emits an `info-card`
 * component item when the LLM calls it. Tool description follows the
 * "USE FOR / DO NOT USE FOR" template so the model can discriminate this shape
 * from neighboring shapes in the palette.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { InfoCardSchema, type InfoCardData } from "./schema";
import type { GenerativeToolOptions } from "../tool-types";

const DESCRIPTION = [
  "Render a structured information card with a title, optional image, and up to 8 fact rows.",
  "USE FOR: profile snapshots, place summaries, contact-style info, quick reference cards.",
  "DO NOT USE FOR: comparisons (use emitDualColumn), tabular numeric data (use emitMetricGrid), external resources with a URL (use emitLinkCard), or long prose (just respond with text).",
].join(" ");

export function emitInfoCardTool(
  options: GenerativeToolOptions<typeof InfoCardSchema> = {}
): BlockDefinition {
  const keyFrom = options.keyFrom ?? ((input: InfoCardData) => input.id);
  return handler({
    name: "emitInfoCard",
    description: DESCRIPTION,
    inputSchema: InfoCardSchema,
    execute: (input, ctx) => {
      ctx.emitComponent("info-card", input, { key: keyFrom(input) });
      return { rendered: true, kind: "info-card", id: input.id };
    },
  });
}
