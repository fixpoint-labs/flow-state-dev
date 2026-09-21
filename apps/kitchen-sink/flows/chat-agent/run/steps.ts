/**
 * Small flow-level steps for the chat turn — state writes and thinking-style
 * resolution that sit around the main router in `run/run.ts`.
 *
 * These only mutate session state (`.tap`-shaped) — the requested mode, the
 * feature flags, the resolved thinking style, the request count. None produce
 * conversational output.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  inputSchema,
  modeSchema,
  featuresSchema,
  thinkingStyleSessionStateSchema,
} from "../shared/schemas";

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
 * Resolve the turn's thinking style: the caller's requested style is written
 * straight to session state.
 *
 * This used to branch, because `"auto"` ran a keyword scan and then an LLM
 * classifier to pick one of five coordination routes. With those routes gone
 * (FIX-1478) the caller's choice is the whole resolution, and the action's
 * input schema has already refused anything outside the set.
 */
export const resolveThinkingStyle = sequencer({
  name: "resolve-thinking-style",
  inputSchema,
}).tap(
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
