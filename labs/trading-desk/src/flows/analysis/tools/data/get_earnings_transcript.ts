/**
 * Earnings-call transcript data tool. FMP-key-gated: returns `available: false`
 * when no FMP_API_KEY is set. PR1 stubs this as always-unavailable in live mode;
 * fixture mode returns the fixture (which carries a sample transcript).
 */
import { handler } from "@flow-state-dev/core";
import { loadFixture } from "../runtime/fixtures";
import { emptyPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_earnings_transcript = handler({
  name: "get_earnings_transcript",
  description:
    "Fetch the latest earnings-call transcript for a ticker. Requires " +
    "FMP_API_KEY (free tier). Returns capped prepared remarks + Q&A slice.",
  inputSchema: toolInputSchemas.get_earnings_transcript,
  outputSchema: toolOutputSchemas.get_earnings_transcript,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") {
      return loadFixture("get_earnings_transcript", input);
    }
    // PR1: always return unavailable in live mode. PR2 wires FMP.
    return emptyPayload("get_earnings_transcript", input);
  },
});
