/**
 * chat-agent flow — the two values its page watches, as views.
 *
 * - `modeStatus` (session): what the session last ran with, for the top
 *   bar and the composer's controls. It is the one surface that reads the
 *   stored thinking style raw, so a style this app removed is folded to
 *   `default` here, before it leaves the server (BP-030).
 * - `preferences` (user): the user's display name, model and extended-thinking
 *   toggle, from user state.
 *
 * The page names them with `viewRef<typeof modeStatusView>` (a type import),
 * so the browser bundle never holds these blocks.
 */
import { defineView, handler } from "@flow-state-dev/core";
import { z } from "zod";

import {
  coalesceThinkingStyle,
  featuresSchema,
  modeSchema,
  sessionStateSchema,
  thinkingStyleSchema,
  userStateSchema,
} from "./shared/schemas";

/** What the session last ran with, as the page draws it. */
const modeStatusSchema = z.object({
  currentMode: modeSchema,
  /** `null` for a session that never chose one. */
  thinkingStyle: thinkingStyleSchema.nullable(),
  requestCount: z.number(),
  features: featuresSchema,
  activeSkills: z.array(z.object({ name: z.string(), source: z.string(), mode: z.enum(["inline", "fork", "pattern"]).optional() })),
});

/** The session's mode, thinking style, features and active skills. */
export const modeStatusView = defineView({
  scope: "session",
  block: handler({
    name: "chat-agent-mode-status",
    description: "What the session last ran with: mode, thinking style, features and active skills.",
    inputSchema: z.object({}),
    outputSchema: modeStatusSchema,
    sessionStateSchema,
    execute: (_input, ctx) => {
      const state = ctx.session.state;
      return {
        // A retired mode stored before the enum changed is refused here
        // rather than reaching the browser raw (BP-030).
        currentMode: modeSchema.parse(state.mode),
        // A session written before FIX-1478 holds a style this app removed:
        // folded to `default`, not sent to a browser with no entry for it.
        thinkingStyle: coalesceThinkingStyle(state.thinkingStyle),
        requestCount: state.requestCount,
        features: state.features,
        activeSkills: (state.activeSkills as Array<{ name: string; source?: string; mode?: "inline" | "fork" | "pattern" }>).map((s) => ({
          name: s.name,
          source: s.source ?? "tool",
          ...(s.mode !== undefined ? { mode: s.mode } : {}),
        })),
      };
    },
  }),
});

/** The user's display name, selected model and extended-thinking toggle. */
export const preferencesView = defineView({
  scope: "user",
  block: handler({
    name: "chat-agent-preferences",
    description: "The user's display name, selected model and extended-thinking toggle.",
    inputSchema: z.object({}),
    outputSchema: z.object({ displayName: z.string(), selectedModel: z.string(), thinkingEnabled: z.boolean() }),
    userStateSchema,
    execute: (_input, ctx) => ({
      displayName: ctx.user.state.displayName,
      selectedModel: ctx.user.state.selectedModel,
      thinkingEnabled: ctx.user.state.thinkingEnabled,
    }),
  }),
});
