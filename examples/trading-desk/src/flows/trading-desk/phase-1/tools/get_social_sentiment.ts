/**
 * 7-day social-sentiment score. No live provider is wired (paid APIs would
 * be required for real coverage), so live mode returns an empty payload
 * tagged `unavailable`. Fixture mode loads curated NVDA JSON.
 */
import { handler } from "@flow-state-dev/core";
import { loadFixture } from "../../services/fixtures";
import { emptyPayload } from "./empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "./schemas";

export const get_social_sentiment = handler({
  name: "get_social_sentiment",
  description: "7-day social-sentiment score and short-interest signal.",
  inputSchema: toolInputSchemas.get_social_sentiment,
  outputSchema: toolOutputSchemas.get_social_sentiment,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_social_sentiment", input);
    return emptyPayload("get_social_sentiment", input);
  },
});
