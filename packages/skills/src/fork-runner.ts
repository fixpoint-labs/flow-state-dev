/**
 * Fork-mode subagent runner.
 *
 * When a skill declares `context: fork` in its frontmatter, runSkill
 * spawns an isolated subagent: a single `model.generate()` call with the
 * substituted SKILL.md body as the system message and the resolved subset
 * of catalog tools (per `allowed-tools`). The parent generator's main
 * context only sees the runSkill tool call and its return value.
 *
 * This intentionally bypasses the framework's block factory — fork mode is
 * exactly the use case where a handler needs to launch a one-shot model
 * call with isolated context, and going through `block.run()` would
 * surface the subagent's tool calls as separate items in the parent's
 * trace (defeating the isolation guarantee).
 */

import type {
  BlockContext,
  GeneratorModelTool,
} from "@flow-state-dev/core/types";
import type { Skill, ToolCatalog } from "@flow-state-dev/core";

export interface ForkRunOptions {
  /** Resolved skill descriptor. */
  skill: Skill;
  /** Skill body with `$ARGUMENTS` / `${CLAUDE_SKILL_DIR}` already substituted. */
  body: string;
  /** Tool catalog the parent generator was configured with. */
  catalog: ToolCatalog;
  /** Override model. When omitted, the parent's default model preset is used. */
  modelId?: string;
  /** Maximum tool-loop steps for the subagent. */
  maxSteps?: number;
  /** Token budget for the subagent. */
  maxTokens?: number;
}

/**
 * Run a skill in fork mode. Returns the subagent's text output (or, if the
 * skill declared an outputSchema, the structured result).
 */
export async function runSkillFork(
  ctx: BlockContext,
  opts: ForkRunOptions,
): Promise<unknown> {
  const { skill, body, catalog, modelId, maxSteps = 12, maxTokens } = opts;

  // Resolve the model. Default to the framework's medium preset so fork
  // mode works even when the parent generator did not specify a model
  // string the resolver can route to.
  const resolvedId = modelId ?? "preset/medium";
  const model = ctx.resolveModel(resolvedId, `skill:${skill.name}`);

  // Resolve the allowed tools against the catalog. Unknown refs warn and
  // are skipped — additive semantics in V1 always honor whatever the
  // catalog provides.
  const allowed = skill.allowedTools ?? Object.keys(catalog);
  const resolvedTools: GeneratorModelTool[] = [];
  for (const key of allowed) {
    const tool = catalog[key];
    if (!tool) {
      console.warn(
        `[skills] fork "${skill.name}": unknown tool "${key}" — skipped`,
      );
      continue;
    }
    resolvedTools.push(toModelTool(tool, ctx));
  }

  const messages = [
    { role: "system" as const, content: body },
    {
      role: "user" as const,
      content:
        "Run the skill above. Return your final answer as plain text.",
    },
  ];

  const result = await model.generate({
    messages,
    tools: resolvedTools.length > 0 ? resolvedTools : undefined,
    maxSteps,
    maxTokens,
    signal: ctx.signal,
  });

  return result.structuredOutput ?? result.text ?? null;
}

/**
 * Adapt a framework BlockDefinition (which is what `GeneratorTool` aliases to)
 * into the AI SDK shape the model adapter expects. The `execute` closure runs
 * the block via its `run` method using the parent ctx — so the subagent's
 * tool calls share the same scopes as the parent.
 */
function toModelTool(
  tool: { name: string; description?: string; inputSchema?: unknown; run: (input: unknown, ctx: BlockContext) => Promise<unknown> },
  ctx: BlockContext,
): GeneratorModelTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as never,
    execute: async (args: unknown) => {
      return await tool.run(args, ctx);
    },
  };
}
