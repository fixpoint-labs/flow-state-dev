/**
 * Inline-mode skill activation — a `handler` block.
 *
 * Inline mode is a pure session-state mutation: append the activated skill
 * to `activeSkills` so the next generator step's dynamic context
 * formatter renders the substituted skill body into the system prompt.
 * Extracted from `run-skill-tool.ts` as part of the router-based rewrite.
 */

import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  pushActiveSkill,
  activeSkillStateSchema,
  readActiveSkills,
  type ActiveSkillEntry,
} from "./active-skill-state";

const inlineActivateInputSchema = z.object({
  skillName: z.string(),
  input: z.string().optional(),
});

const inlineActivateOutputSchema = z.object({
  skill: z.string(),
  mode: z.literal("inline"),
  message: z.string(),
});

export const inlineActivate = handler({
  name: "skillInlineActivate",
  inputSchema: inlineActivateInputSchema,
  outputSchema: inlineActivateOutputSchema,
  sessionStateSchema: activeSkillStateSchema,
  execute: async (input, ctx) => {
    const entry: ActiveSkillEntry = {
      name: input.skillName,
      mode: "inline",
      input: input.input,
      activatedAt: Date.now(),
    };
    await ctx.session.patchState({
      activeSkills: pushActiveSkill(readActiveSkills(ctx.session.state), entry),
    });
    return {
      skill: input.skillName,
      mode: "inline" as const,
      message: `Skill "${input.skillName}" activated. Its instructions are now in your system context — re-read it before proceeding.`,
    };
  },
});
