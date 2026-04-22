/**
 * Inline-mode skill activation — a `handler` block.
 *
 * Inline mode is a pure session-state mutation: append the activated skill
 * to `__activeSkills` so the next generator step's dynamic context
 * formatter renders the substituted skill body into the system prompt.
 * Extracted from `run-skill-tool.ts` as part of the router-based rewrite.
 */

import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  pushActiveSkill,
  readActiveSkills,
  type ActiveSkillEntry,
} from "./active-skill-state";

export const inlineActivateInputSchema = z.object({
  skillName: z.string(),
  input: z.string().optional(),
});

export const inlineActivateOutputSchema = z.object({
  skill: z.string(),
  mode: z.literal("inline"),
  message: z.string(),
});

export const inlineActivate = handler({
  name: "skillInlineActivate",
  inputSchema: inlineActivateInputSchema,
  outputSchema: inlineActivateOutputSchema,
  execute: async (input, ctx) => {
    const current = readActiveSkills(ctx.session.state);
    const entry: ActiveSkillEntry = {
      name: input.skillName,
      mode: "inline",
      input: input.input,
      activatedAt: Date.now(),
    };
    await ctx.session.patchState({
      __activeSkills: pushActiveSkill(current, entry),
    } as never);
    return {
      skill: input.skillName,
      mode: "inline" as const,
      message: `Skill "${input.skillName}" activated. Its instructions are now in your system context — re-read it before proceeding.`,
    };
  },
});
