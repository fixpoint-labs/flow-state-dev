/**
 * Fork-mode skill subagent — a framework `generator` block.
 *
 * When a skill declares `context: fork` in its frontmatter, `runSkill`
 * dispatches the invocation to this generator. The subagent runs with
 * `agentType: "sub"`, meaning its tool calls and streaming output reach
 * the client for live observability but are excluded from the parent
 * conversation's history — the isolation guarantee fork skills need,
 * without bypassing the framework.
 *
 * Per-invocation inputs:
 *   - `body`: the substituted SKILL.md body, used as the system prompt.
 *   - `allowedToolNames`: list of catalog keys the skill can invoke.
 *   - `modelId`: optional model override.
 *
 * Catalog tools are resolved per-invocation via `tools: (input, ctx) => ...`.
 * Unknown tool names warn and are skipped, matching the previous behavior.
 */

import { generator, type GeneratorTool } from "@flow-state-dev/core";
import type { ToolCatalog } from "@flow-state-dev/core";
import { z } from "zod";

export const forkInputSchema = z.object({
  /** Skill name — used only for logging. */
  skillName: z.string(),
  /** Substituted SKILL.md body, used as the subagent's system prompt. */
  body: z.string(),
  /** Catalog keys the skill is allowed to invoke. */
  allowedToolNames: z.array(z.string()),
  /** Optional model id override. Defaults to `intent/chat`. */
  modelId: z.string().optional(),
});

export type SkillForkInput = z.infer<typeof forkInputSchema>;

export interface CreateSkillForkGeneratorOptions {
  /** Tool catalog the parent generator was configured with. */
  catalog: ToolCatalog;
  /** Default model id when the skill-invocation input doesn't set one. */
  defaultModelId?: string;
  /** Maximum tool-loop steps for the subagent. */
  maxSteps?: number;
  /** Token budget for the subagent. */
  maxTokens?: number;
}

/**
 * Build the fork-mode generator. The returned block is registered once and
 * invoked per-skill via `.connectInput(...)` in the `runSkill` router —
 * input resolution (body substitution, allowed-tools filtering) happens
 * upstream in the router, and per-invocation state flows through the
 * generator's input.
 */
export function createSkillForkGenerator(
  options: CreateSkillForkGeneratorOptions,
) {
  const {
    catalog,
    defaultModelId = "intent/chat",
    maxSteps = 12,
    maxTokens,
  } = options;

  return generator({
    name: "skillFork",
    agentType: "sub",
    agentName: "skill-fork",
    inputSchema: forkInputSchema,
    // Output is whatever the subagent returns — plain text unless the skill
    // declared an outputSchema (not supported in V1 of the skills package).
    // The router wraps this into the public runSkill output shape.
    outputSchema: z.string(),
    model: (input) => input.modelId ?? defaultModelId,
    prompt: (input) => input.body,
    user: "Run the skill above. Return your final answer as plain text.",
    tools: (input, _ctx) => resolveForkTools(input, catalog),
    maxIterations: maxSteps,
    maxTokens,
  });
}

function resolveForkTools(
  input: SkillForkInput,
  catalog: ToolCatalog,
): GeneratorTool[] {
  const resolved: GeneratorTool[] = [];
  for (const key of input.allowedToolNames) {
    const tool = catalog[key];
    if (!tool) {
      console.warn(
        `[skills] fork "${input.skillName}": unknown tool "${key}" — skipped`,
      );
      continue;
    }
    resolved.push(tool);
  }
  return resolved;
}
