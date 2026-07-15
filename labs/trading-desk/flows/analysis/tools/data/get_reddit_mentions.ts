/**
 * Recent Reddit mentions and top threads. No live provider wired (Reddit
 * OAuth would be required), so live mode returns an empty payload tagged
 * `unavailable`. Fixture mode loads curated NVDA JSON.
 */
import { handler } from "@flow-state-dev/core";
import { resolveToolPayload } from "../runtime/resolve";
import { emptyPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_reddit_mentions = handler({
  name: "get_reddit_mentions",
  description: "Recent Reddit mentions and top threads for a ticker.",
  inputSchema: toolInputSchemas.get_reddit_mentions,
  outputSchema: toolOutputSchemas.get_reddit_mentions,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_reddit_mentions", input, ctx, async () => {
      return emptyPayload("get_reddit_mentions", input);
    });
  },
});
