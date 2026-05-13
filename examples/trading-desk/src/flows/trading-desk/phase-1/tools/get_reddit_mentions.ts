/**
 * Recent Reddit mentions and top threads. No live provider wired (Reddit
 * OAuth would be required), so live mode returns an empty payload tagged
 * `unavailable`. Fixture mode loads curated NVDA JSON.
 */
import { handler } from "@flow-state-dev/core";
import { loadFixture } from "../../services/fixtures";
import { emptyPayload } from "./empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "./schemas";

export const get_reddit_mentions = handler({
  name: "get_reddit_mentions",
  description: "Recent Reddit mentions and top threads for a ticker.",
  inputSchema: toolInputSchemas.get_reddit_mentions,
  outputSchema: toolOutputSchemas.get_reddit_mentions,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_reddit_mentions", input);
    return emptyPayload("get_reddit_mentions", input);
  },
});
