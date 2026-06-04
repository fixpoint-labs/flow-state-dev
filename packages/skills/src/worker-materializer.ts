/**
 * Worker materialization for pattern skills.
 *
 * Given a parsed `WorkerSpec` (one of `prompt`, `promptRef`, `blockRef`,
 * `agentRef`), build a `TaskWorker`-shaped `BlockDefinition` suitable
 * for plugging into a pattern factory's worker registry.
 *
 * The `agentRef` branch is the explicit forward-compat hook for the
 * Agents primitive — this work parses the field, validates that the
 * caller-supplied `agentRegistry` is wired, and then stubs activation
 * with a clear deferral error. When the Agents package ships, the
 * inner stub-throw is replaced with a call to `materializeAgent`.
 */

import {
  generator,
  type GeneratorTool,
} from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { TaskWorkerInput } from "@flow-state-dev/tasks";
import type { PatternRegistryDeps } from "./pattern-registry";
import { skillFileKey } from "./collection";
import { stripFrontmatter } from "./internal/strip-frontmatter";
import { substitute } from "./skill-md";
import { taskTools as taskToolsCapability } from "./task-tools-capability";
import type { WorkerSpec } from "@flow-state-dev/core";

/** Input every materialized worker accepts — matches the substrate's TaskWorkerInput. */
export const workerInputSchema = z.object({
  taskId: z.string(),
  goal: z.string(),
  input: z.unknown().optional(),
  attempts: z.number(),
  feedback: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  deps: z.record(z.string(), z.unknown()).optional(),
});

type WorkerInput = TaskWorkerInput;

/**
 * Build the executable block for one worker entry of a pattern skill.
 *
 * Dispatch order (parse-time mutual exclusion guarantees exactly one
 * branch fires):
 *   1. `blockRef` → look up in `deps.blocks`.
 *   2. `agentRef` → stubbed; throws either "no registry configured" or
 *      "registry supplied but Agents implementation not wired".
 *   3. `promptRef` → read file from the skill collection.
 *   4. `prompt` → use the inline body.
 *
 * For prompt-driven workers, the materializer composes a generator whose
 * system prompt is the substituted worker body. Per-invocation the
 * generator builds a user message from the task goal and any upstream
 * dep outputs, runs to a final answer, and returns the assistant text.
 */
export async function materializeWorker(
  workerKey: string,
  spec: WorkerSpec,
  deps: PatternRegistryDeps,
): Promise<BlockDefinition> {
  // 1. block-ref — look up in the optional block registry.
  if (spec.blockRef !== undefined) {
    const registry = deps.blocks ?? {};
    const block = registry[spec.blockRef];
    if (!block) {
      const available = Object.keys(registry).join(", ") || "(empty)";
      throw new Error(
        `Worker '${workerKey}': block-ref '${spec.blockRef}' not found in block registry. Available: ${available}`,
      );
    }
    return block;
  }

  // 2. agent-ref — resolve a registered Agent via the injected registry
  //    and materializeAgent function.
  if (spec.agentRef !== undefined) {
    if (!deps.agentRegistry) {
      throw new Error(
        `Worker '${workerKey}' uses agent-ref '${spec.agentRef}' but no ` +
          `agentRegistry was supplied to createSkillsCapability. ` +
          `Wire an AgentRegistry via createSkillsCapability({ agentRegistry }) ` +
          `or use prompt/prompt-ref instead.`,
      );
    }
    if (!deps.materializeAgent) {
      throw new Error(
        `Worker '${workerKey}' uses agent-ref '${spec.agentRef}' but no ` +
          `materializeAgent function was supplied to createSkillsCapability. ` +
          `Wire it via createSkillsCapability({ materializeAgent }).`,
      );
    }
    const agent = await deps.agentRegistry.get(spec.agentRef);
    if (!agent) {
      const registered = (await deps.agentRegistry.list()).map((a) => a.name);
      throw new Error(
        `Worker '${workerKey}' references agent '${spec.agentRef}' which is not in the registry. ` +
          `Registered agents: ${registered.join(", ") || "(none)"}.`,
      );
    }
    return deps.materializeAgent(agent, {
      catalog: deps.catalog,
      capabilityCatalog: deps.capabilityCatalog,
      defaultModelId: deps.defaultModelId,
      overrides: spec.agentOverrides,
      shape: "worker",
      workerKey,
      skillName: deps.skillName,
    });
  }

  // 3 & 4. prompt-ref / prompt — both build a generator with the
  // substituted body as system prompt.
  const baseBody = await resolvePromptBody(workerKey, spec, deps);
  const substituted = substitute(baseBody, { arguments: deps.input ?? "" });

  // `taskTools` in the tools array is shorthand for the capability —
  // workers that list it get all eight addTask/.../listTasks tools
  // installed via capability composition rather than a catalog lookup.
  // Filter it out before catalog resolution so it doesn't warn.
  const usesTaskTools = spec.tools?.includes("taskTools") ?? false;
  const catalogToolKeys = spec.tools?.filter((t) => t !== "taskTools");
  const tools = resolveTools(workerKey, catalogToolKeys, deps.catalog);

  // Model resolution: per-worker `model:` wins, then the capability's
  // `defaultModelId`, then the same `"intent/chat"` fallback the
  // fork-mode generator uses. The fallback keeps pattern skills working
  // out of the box without forcing every app to wire a default; apps
  // that want a specific model still override at either level.
  const modelId = spec.model ?? deps.defaultModelId ?? "intent/chat";

  return generator({
    name: `skillWorker_${deps.skillName}_${workerKey}`,
    itemVisibility: spec.itemVisibility ?? { client: true, history: false },
    agentName: `skill-${deps.skillName}-${workerKey}`,
    inputSchema: workerInputSchema,
    outputSchema: z.string(),
    model: modelId,
    prompt: substituted,
    user: (input: WorkerInput) => buildUserMessage(input),
    tools,
    maxIterations: 12,
    ...(usesTaskTools ? { uses: [taskToolsCapability] as const } : {}),
  }) as unknown as BlockDefinition;
}

/** Read the worker's prompt body — inline for `prompt`, file-read for `prompt-ref`. */
async function resolvePromptBody(
  workerKey: string,
  spec: WorkerSpec,
  deps: PatternRegistryDeps,
): Promise<string> {
  if (spec.prompt !== undefined) return spec.prompt;
  // Parser-enforced invariant: exactly one of the four resolution fields
  // is set on every WorkerSpec, and the caller has already dispatched
  // block-ref / agent-ref branches before reaching here.
  const promptRef = spec.promptRef!;
  const key = skillFileKey(deps.skillName, promptRef);
  const ref = await deps.skillCollection.getOptional(key);
  if (!ref) {
    throw new Error(
      `Worker '${workerKey}': prompt-ref '${promptRef}' not found in skill folder (resolved key: ${key})`,
    );
  }
  const content = (await ref.readContent()) ?? "";
  return stripFrontmatter(content);
}

/**
 * Resolve a worker's `tools:` array against the catalog. Mirrors
 * `fork-generator.ts`'s additive-not-restrictive policy: unknown keys
 * warn and drop rather than throw.
 */
function resolveTools(
  workerKey: string,
  toolKeys: readonly string[] | undefined,
  catalog: Record<string, GeneratorTool>,
): GeneratorTool[] {
  if (!toolKeys || toolKeys.length === 0) return [];
  const out: GeneratorTool[] = [];
  for (const key of toolKeys) {
    const tool = catalog[key];
    if (!tool) {
      console.warn(
        `[skills] worker "${workerKey}": unknown tool "${key}" — skipped`,
      );
      continue;
    }
    out.push(tool);
  }
  return out;
}

/** Build the per-invocation user turn from the substrate's TaskWorkerInput. */
export function buildUserMessage(input: WorkerInput): string {
  const parts: string[] = [`Task: ${input.goal}`];
  if (input.feedback) {
    parts.push("", `Reviewer feedback: ${input.feedback}`);
  }
  const deps = input.deps && Object.keys(input.deps).length > 0 ? input.deps : null;
  if (deps) {
    parts.push("", "Upstream outputs:");
    for (const [depId, value] of Object.entries(deps)) {
      const rendered =
        typeof value === "string" ? value : JSON.stringify(value, null, 2);
      parts.push(`- ${depId}: ${rendered}`);
    }
  }
  return parts.join("\n");
}

