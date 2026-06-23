/**
 * User-setting actions — persist per-user preferences to user state.
 *
 * `setSelectedModel` writes the user's concrete-model choice (validated against
 * the kitchen-sink catalog); `setThinkingEnabled` writes the extended-thinking
 * toggle. Both are plain handlers wired as flow actions.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { userStateSchema, selectedModelSchema } from "./shared/schemas";

/** Input for the `setSelectedModel` action. */
const setSelectedModelInputSchema = z.object({
  selectedModel: selectedModelSchema,
});

/** Persists the user's concrete-model selection to user state. */
export const setSelectedModelHandler = handler({
  name: "set-selected-model",
  inputSchema: setSelectedModelInputSchema,
  userStateSchema,
  execute: async (input, ctx) => {
    await ctx.user!.patchState({ selectedModel: input.selectedModel });
  },
});

/** Input for the `setThinkingEnabled` action. */
const setThinkingEnabledInputSchema = z.object({
  thinkingEnabled: z.boolean(),
});

/** Persists the user's extended-thinking toggle to user state. */
export const setThinkingEnabledHandler = handler({
  name: "set-thinking-enabled",
  inputSchema: setThinkingEnabledInputSchema,
  userStateSchema,
  execute: async (input, ctx) => {
    await ctx.user!.patchState({ thinkingEnabled: input.thinkingEnabled });
  },
});
