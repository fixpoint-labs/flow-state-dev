/**
 * Link-card tool factory. Produces a `handler` block that emits a `link-card`
 * component item. Default keying is by URL so re-emissions of the same link
 * collapse into a single card.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { LinkCardSchema, type LinkCardData } from "./schema";
import type { GenerativeToolOptions } from "../types";

const DESCRIPTION = [
  "Render a rich preview card for an external URL with title, optional description, source name, and preview image.",
  "USE FOR: citations, further-reading suggestions, source attributions, replacing bare URLs in answers.",
  "DO NOT USE FOR: structured profile data without a URL (use emitInfoCard), comparisons (use emitDualColumn), or numeric summaries (use emitMetricGrid).",
].join(" ");

export function emitLinkCardTool(
  options: GenerativeToolOptions<typeof LinkCardSchema> = {}
): BlockDefinition {
  const keyFrom = options.keyFrom ?? ((input: LinkCardData) => input.url);
  return handler({
    name: "emitLinkCard",
    description: DESCRIPTION,
    inputSchema: LinkCardSchema,
    execute: (input, ctx) => {
      ctx.emitComponent("link-card", input, { key: keyFrom(input) });
      return { rendered: true, kind: "link-card", url: input.url };
    },
  });
}
