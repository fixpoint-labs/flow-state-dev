/**
 * Small flow-level steps for the chat turn — state writes and thinking-style
 * resolution that sit around the main router in `run/run.ts`.
 *
 * These only mutate session state (`.tap`-shaped) or compose the classifier;
 * none produce conversational output.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  inputSchema,
  modeSchema,
  featuresSchema,
  thinkingStyleSessionStateSchema,
} from "../shared/schemas";
import { autoClassifyStyle } from "./thinking-styles/classify";

/** Persist the caller's requested mode to session state. */
export const applyRequestedMode = handler({
  name: "apply-requested-mode",
  inputSchema,
  sessionStateSchema: z.object({ mode: modeSchema.default("ask") }),
  execute: async (input, ctx) => {
    await ctx.session.patchState({ mode: input.mode });
  },
});

/** Persist the caller's requested feature flags to session state. */
export const applyFeatures = handler({
  name: "apply-features",
  inputSchema,
  sessionStateSchema: z.object({ features: featuresSchema.default({}) }),
  execute: async (input, ctx) => {
    await ctx.session.patchState({ features: input.features });
  },
});

/**
 * Resolve the turn's thinking style: a manually requested style is written
 * straight to session state; `"auto"` runs the keyword + LLM classifier.
 */
export const resolveThinkingStyle = sequencer({
  name: "resolve-thinking-style",
  inputSchema,
})
  .tapIf(
    (input) => input.thinkingStyle !== "auto",
    handler({
      name: "apply-manual-style",
      inputSchema,
      sessionStateSchema: thinkingStyleSessionStateSchema,
      execute: async (input, ctx) => {
        if (input.thinkingStyle !== ctx.session.state.thinkingStyle) {
          await ctx.session.patchState({ thinkingStyle: input.thinkingStyle });
        }
      },
    }),
  )
  .tapIf(
    (input) => input.thinkingStyle === "auto",
    autoClassifyStyle,
  );

/** Bump the per-session request counter and record the last action. */
export const incrementRequestCount = handler({
  name: "increment-request-count",
  sessionStateSchema: z.object({
    requestCount: z.number().default(0),
    lastAction: z.string().optional(),
  }),
  execute: async (_input, ctx) => {
    const count = ctx.session.state.requestCount ?? 0;
    await ctx.session.patchState({
      requestCount: count + 1,
      lastAction: "run",
    });
  },
});
