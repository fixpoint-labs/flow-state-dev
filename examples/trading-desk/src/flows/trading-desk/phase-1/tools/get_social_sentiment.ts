/**
 * 7-day social-sentiment signal for a ticker. Three dispatch routes:
 *
 *   - fixture handler: loads the curated NVDA (or other ticker) fixture
 *   - Grok generator: live X/Twitter sentiment via Grok + xSearch hosted tool
 *   - unavailable handler: zeroed schema-valid payload tagged `unavailable`
 *
 * Live mode prefers Grok when `XAI_API_KEY` is set; otherwise it returns
 * `unavailable` (BP-020: no silent fallback to fixture data). Fixture mode
 * is unchanged.
 *
 * The Grok generator's `outputSchema` forces representative-post evidence
 * for grounding rigor. Posts pass through `connectOutput` to the public
 * `socialSentimentSchema` — the sentiment analyst sees the actual quotes
 * and treats them as primary evidence, with the numeric score as a
 * summary of (not a replacement for) that texture.
 */
import { generator, handler, providerTool, router } from "@flow-state-dev/core";
import { xai } from "@ai-sdk/xai";
import { z } from "zod";
import { tradingDesk } from "../../capability";
import { loadFixture } from "../../lib/fixtures";
import {
  XAI_SENTIMENT_MODEL,
  hasXaiKey,
} from "../../providers/xai";
import { emptyPayload } from "./empty-payloads";
import {
  pickMode,
  type ToolOutput,
  toolInputSchemas,
  toolOutputSchemas,
} from "./schemas";

const inputSchema = toolInputSchemas.get_social_sentiment;
const outputSchema = toolOutputSchemas.get_social_sentiment;

const fixtureRoute = handler({
  name: "get_social_sentiment.fixture",
  inputSchema,
  outputSchema,
  execute: async (input) => loadFixture("get_social_sentiment", input),
});

const unavailableRoute = handler({
  name: "get_social_sentiment.unavailable",
  inputSchema,
  outputSchema,
  execute: async (input) => emptyPayload("get_social_sentiment", input),
});

// Generator output: forces representative posts so the score is grounded
// in retrieved evidence rather than the model's training recall. `posts`
// is passed straight through to the public schema — the analyst reads the
// quotes, not just the counts.
export const grokOutputSchema = z.object({
  score7d: z.number(),
  positive: z.number().int().nonnegative(),
  negative: z.number().int().nonnegative(),
  neutral: z.number().int().nonnegative(),
  posts: z.array(
    z.object({
      handle: z.string(),
      excerpt: z.string(),
      polarity: z.enum(["positive", "negative", "neutral"]),
    }),
  ),
});

const sentimentPrompt = [
  "You characterize X (Twitter) sentiment for a single equity ticker over a",
  "fixed 7-day window ending on the provided date.",
  "",
  "Use the xSearch tool to retrieve recent posts about the ticker. Reason",
  "only over retrieved posts. Do NOT recall from training. Do NOT estimate",
  "counts you did not observe.",
  "",
  "Scoring:",
  "- score7d: a single number in [-1, 1]. -1 = strongly bearish, +1 =",
  "  strongly bullish, 0 = mixed or neutral. Default to 0 when uncertain.",
  "- positive / negative / neutral: counts OVER THE RETRIEVED POSTS ONLY.",
  "  Never \"how many people on X are bullish\" overall — only the retrieved",
  "  sample. Counts must sum to the number of posts you actually classified.",
  "- If xSearch returns no relevant posts, return all zeros with empty",
  "  evidence.",
  "",
  "Posts (primary deliverable):",
  "- Return 8-15 representative posts spanning the polarity distribution.",
  "- The downstream analyst reads these directly — they are the main",
  "  value of this call, not the score. Pick quotes that actually carry",
  "  information (concrete claims, reactions to events, specific numbers),",
  "  not generic hype or one-word reactions.",
  "- Use the actual handle and a short excerpt (one sentence, verbatim).",
  "  No paraphrasing. No invented handles. No invented posts.",
].join("\n");

// `providerTools` is static (the framework does not resolve it per call),
// so the xSearch tool is constructed once at module load. Date-window
// scoping is enforced via prompt rigor rather than tool-level
// `fromDate`/`toDate` filters — those would require per-call tool
// instances. The model gets the target date in its user slot and is
// instructed to focus on the trailing 7 days.
const xSearchTool = providerTool("xSearch", xai.tools.xSearch());

const grokRoute = generator({
  name: "get_social_sentiment.xai",
  agentType: "sub",
  uses: [tradingDesk],
  // Explicit `model` overrides the tradingDesk core preset's
  // intent-based selector. This route is pinned to Grok regardless of
  // `costPreset` — sentiment is the one tool that needs an xAI-specific
  // model.
  model: XAI_SENTIMENT_MODEL,
  // Headroom for the model to call xSearch and then emit structured
  // output across separate steps.
  maxIterations: 3,
  inputSchema,
  outputSchema: grokOutputSchema,
  providerTools: [xSearchTool],
  prompt: sentimentPrompt,
  user: (input) =>
    `Ticker: ${input.ticker}. Characterize sentiment over the 7 days ending ${input.date}. Use xSearch to retrieve relevant posts about $${input.ticker} from that window.`,
});

// Adapt grokRoute's output to the tool's public schema once at module
// load. `connectOutput` produces a new BlockDefinition with the same
// `.name` as `grokRoute`; the router matches candidates by name OR
// reference, so this adapted block still satisfies route validation.
//
// `shortInterestPct` is null on this route — X chatter can't measure
// short interest, and a fabricated 0 reads as "no shorts" to the analyst.
// `ticker` and `asOf` come from `ctx.session.state` because
// `connectOutput`'s mapper only sees `(output, ctx)` (no input
// pass-through). The trading-desk capability populates both fields.
const grokAdaptedRoute = grokRoute.connectOutput(
  (gen, ctx): ToolOutput<"get_social_sentiment"> => {
    const state = ctx.session.state as Partial<{ ticker: string; date: string }>;
    // Read defensively: the trading-desk flow seeds these via
    // `sessionStateSchema`, so absence indicates an upstream wiring
    // bug. Surface that directly rather than letting
    // `socialSentimentSchema`'s `z.string()` reject `undefined` with a
    // less actionable error.
    if (!state.ticker || !state.date) {
      throw new Error(
        "get_social_sentiment.xai: session.state.ticker and session.state.date must be populated before the Grok route runs",
      );
    }
    return {
      source: "xai",
      ticker: state.ticker,
      asOf: state.date,
      score7d: clamp(gen.score7d, -1, 1),
      positive: gen.positive,
      negative: gen.negative,
      neutral: gen.neutral,
      shortInterestPct: null,
      posts: gen.posts,
    };
  },
);

export const get_social_sentiment = router({
  name: "get_social_sentiment",
  description: "7-day social-sentiment score and short-interest signal.",
  inputSchema,
  outputSchema,
  // Cast: `grokAdaptedRoute` carries the same `.name` as `grokRoute` but
  // `connectOutput` widens its output type to `ZodTypeAny`. The router
  // matches candidates by name OR reference at runtime, so the
  // wider-typed adapted block is a valid route in practice; TypeScript
  // can't see that without the assertion. Same pattern as
  // `packages/skills/src/run-skill-tool.ts:185`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routes: [fixtureRoute, grokAdaptedRoute as any, unavailableRoute],
  execute: (_input, ctx) => {
    if (pickMode(ctx) === "fixture") return fixtureRoute;
    if (!hasXaiKey()) return unavailableRoute;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return grokAdaptedRoute as any;
  },
});

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Exposed for tests — direct-invocation of the leaf routes is the
// cleanest way to assert handler-level behavior without instantiating
// the full block runtime.
export const _routesForTest = {
  fixtureRoute,
  grokRoute,
  grokAdaptedRoute,
  unavailableRoute,
};
