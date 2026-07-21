/**
 * Fork-mode skill subagent — a framework `generator` block.
 *
 * When a skill declares `context: fork` in its frontmatter, the fork tool
 * (installed by `createSkillsLibrary`'s `fork` preset) dispatches the
 * invocation to this generator. The subagent runs with
 * `itemVisibility: { client: true, history: false }`, meaning its tool
 * calls and streaming output reach the client for live observability but
 * are excluded from the parent conversation's history — the isolation
 * guarantee fork skills need, without bypassing the framework.
 *
 * **History inheritance (FIX-919).** The subagent seeds its messages from the
 * engine's already-assembled history view via the generator `history` slot
 * (`ctx.session.items.history()`, shared by reference from the parent's
 * execution context). This is what makes a fork behave like a real fork in
 * the road: the child picks up the conversation up to the fork point, then
 * diverges. `history()` self-excludes the child's own `history: false` work
 * and the still-in-flight fork tool call, so no dangling tool call leaks into
 * the seeded messages. Assembly order is `system (skill body) → history
 * (inherited) → user (task)`.
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
import type { MessageLimit } from "@flow-state-dev/core/types";
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
  /**
   * Bound on the inherited history the subagent seeds from. Whole turns, never
   * split mid-tool-pair (uses the engine's turn-aligned `MessageLimit`).
   * Omitted = inherit all history up to the fork point.
   */
  historyLimit?: MessageLimit;
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
    historyLimit,
  } = options;

  return generator({
    name: "skillFork",
    itemVisibility: { client: true, history: false },
    agentName: "skill-fork",
    inputSchema: forkInputSchema,
    // Output is whatever the subagent returns — plain text unless the skill
    // declared an outputSchema (not supported in V1 of the skills package).
    // The fork tool wraps this into the public fork output shape.
    outputSchema: z.string(),
    model: (input) => input.modelId ?? defaultModelId,
    prompt: (input) => input.body,
    // Seed prior turns between the skill body (system) and the run instruction
    // (user). `history: true` reads `ctx.session.items.history()`; the optional
    // limit bounds it by whole turns so a long conversation doesn't blow up the
    // (uncached) child prompt. See the module header for the fork-point semantics.
    history: historyLimit ? { limit: historyLimit } : true,
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
