/**
 * Worker materialization for delegation skills (FIX-918).
 *
 * Given a parsed `WorkerSpec` (one of `prompt`, `promptRef`, `blockRef`,
 * `agentRef`), build a `BlockDefinition` the delegation surface exposes as a
 * callable tool. Two materialization modes:
 *
 *   - **direct** — the executive calls the worker as an ordinary tool. The
 *     tool's `inputSchema` is the minimal LLM-facing `{ input }` shape (the
 *     task content), and the tool name is the bare worker key (`briefer`), so
 *     `assignee` strings, tool names, and the roster all line up. This is the
 *     single-shot delegation path (call one, get its result inline).
 *   - **board** — the worker is dispatched by a `taskBoard().drain` step. Its
 *     `inputSchema` is the substrate's `workerInputSchema`
 *     (`taskId`/`goal`/`attempts`/…) and its name is namespaced
 *     (`skillWorker_<skill>_<key>`), matching what `dispatch-and-execute`
 *     feeds. Used by the Shape 2 drain path.
 *
 * The `agentRef` branch resolves a registered Agent through the injected
 * registry + `materializeAgent`. `blockRef` looks up an app-registered block.
 */

import {
  generator,
  type GeneratorTool,
} from "@flow-state-dev/core";
import type {
  AgentRegistry,
  DefinedCapability,
  MaterializeAgentFn,
  ToolCatalog,
  WorkerSpec,
} from "@flow-state-dev/core";
import type {
  BlockDefinition,
  ResourceCollectionRef,
} from "@flow-state-dev/core/types";
import { z } from "zod";
import type { TaskWorkerInput } from "../tasks";
import { skillFileKey } from "./collection";
import { stripFrontmatter } from "./internal/strip-frontmatter";
import { substitute } from "./skill-md";
import { taskTools as taskToolsCapability } from "./task-tools-capability";

/**
 * Dependencies for materializing a skill's workers. Decoupled from the removed
 * pattern registry (FIX-918); the pattern-only `collectionId` is gone.
 */
export interface WorkerMaterializationDeps {
  /** Tool catalog. Workers resolve their `tools:` field against this. */
  catalog: ToolCatalog;
  /** Optional block catalog for `block-ref:` workers. Default `{}`. */
  blocks?: Record<string, BlockDefinition>;
  /**
   * Optional agent registry consumed by `agent-ref:` workers. When undefined,
   * any worker using `agent-ref` fails with a "no registry configured" error.
   */
  agentRegistry?: AgentRegistry;
  /** Optional capability catalog forwarded to `materializeAgent`. */
  capabilityCatalog?: Record<string, DefinedCapability>;
  /** Injected materializer that turns a resolved Agent into a worker generator. */
  materializeAgent?: MaterializeAgentFn;
  /** Skill name — used for the board-mode block name. */
  skillName: string;
  /** Skill resource collection — supports `prompt-ref` reads. */
  skillCollection: ResourceCollectionRef;
  /** Default model id when a worker omits its own `model`. */
  defaultModelId?: string;
  /** Activation input ($ARGUMENTS substitution context). */
  input?: string;
  /**
   * Optional board-bound `taskTools` capability for a worker that itself
   * declares `tools: [taskTools]` (Shape 2 fan-out). When set, the worker's
   * `taskTools` resolve against the drain board it was dispatched from rather
   * than the singleton's own-state default. When unset, the singleton is used.
   */
  boardTaskTools?: DefinedCapability;
}

/** Board-mode input — matches the substrate's TaskWorkerInput. */
export const workerInputSchema = z.object({
  taskId: z.string(),
  goal: z.string(),
  input: z.unknown().optional(),
  attempts: z.number(),
  feedback: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  deps: z.record(z.string(), z.unknown()).optional(),
});

/** Direct-call (single-shot) input — the minimal LLM-facing shape. */
export const directWorkerInputSchema = z.object({
  input: z
    .string()
    .describe("The unit of work to hand to this worker (substituted for $ARGUMENTS)."),
});

type WorkerInput = TaskWorkerInput;

/** How a worker's callable surface is shaped. */
export type WorkerMaterializeMode = "direct" | "board";

/**
 * Build the direct-call (single-shot) worker generator from an already-resolved
 * prompt body. Shared by the async `materializeWorker` and the synchronous
 * build-time `buildDirectWorkerTool` (used by `createSkillsLibrary`'s resolver,
 * which is pure and cannot await). The tool is named by the bare worker key and
 * exposes the minimal LLM-facing `{ input }` schema.
 */
function buildDirectWorkerGenerator(params: {
  workerKey: string;
  skillName: string;
  body: string;
  modelId: string;
  tools: GeneratorTool[];
  itemVisibility?: WorkerSpec["itemVisibility"];
  usesTaskTools: boolean;
  taskToolsCap: DefinedCapability;
  description?: string;
}): BlockDefinition {
  return generator({
    name: params.workerKey,
    description:
      params.description ??
      `Hand a unit of work to the ${params.workerKey} worker and get its result.`,
    itemVisibility: params.itemVisibility ?? { client: true, history: false },
    agentName: `skill-${params.skillName}-${params.workerKey}`,
    inputSchema: directWorkerInputSchema,
    outputSchema: z.string(),
    model: params.modelId,
    prompt: params.body,
    user: (input: z.infer<typeof directWorkerInputSchema>) => `Task: ${input.input}`,
    tools: params.tools,
    maxIterations: 12,
    ...(params.usesTaskTools ? { uses: [params.taskToolsCap] as const } : {}),
  }) as unknown as BlockDefinition;
}

/**
 * Synchronous direct-call worker-tool builder for the delegation surface's
 * build-time path. Handles `prompt` (and `promptRef` when its body is
 * pre-resolved by the caller from bundled skill files) and `block-ref`.
 * `agent-ref` requires async registry resolution and is therefore only
 * available through {@link materializeWorker}; the delegation surface rejects
 * it at bind time with a clear message.
 */
export function buildDirectWorkerTool(
  workerKey: string,
  spec: WorkerSpec,
  deps: {
    catalog: ToolCatalog;
    blocks?: Record<string, BlockDefinition>;
    skillName: string;
    /** Pre-resolved prompt body (required for `prompt-ref` workers). */
    resolvedPrompt?: string;
    defaultModelId?: string;
    input?: string;
    boardTaskTools?: DefinedCapability;
    description?: string;
  },
): BlockDefinition {
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
  if (spec.agentRef !== undefined) {
    throw new Error(
      `Worker '${workerKey}': agent-ref delegation workers are not supported here — ` +
        `agent resolution is async. Use a \`prompt\`/\`prompt-ref\` worker, or expose the ` +
        `agent as a catalog block referenced via \`block-ref\`.`,
    );
  }
  const body = spec.prompt ?? deps.resolvedPrompt;
  if (body === undefined) {
    throw new Error(
      `Worker '${workerKey}': no prompt body resolved (expected inline \`prompt\` or a resolved \`prompt-ref\`)`,
    );
  }
  const substituted = substitute(body, { arguments: deps.input ?? "" });
  const usesTaskTools = spec.tools?.includes("taskTools") ?? false;
  const taskToolsCap = deps.boardTaskTools ?? taskToolsCapability;
  const catalogToolKeys = spec.tools?.filter((t) => t !== "taskTools");
  const tools = resolveTools(workerKey, catalogToolKeys, deps.catalog);
  const modelId = spec.model ?? deps.defaultModelId ?? "intent/chat";
  return buildDirectWorkerGenerator({
    workerKey,
    skillName: deps.skillName,
    body: substituted,
    modelId,
    tools,
    itemVisibility: spec.itemVisibility,
    usesTaskTools,
    taskToolsCap,
    ...(deps.description !== undefined ? { description: deps.description } : {}),
  });
}

export interface MaterializeWorkerOptions {
  /** `"direct"` (default) for a single-shot delegation tool; `"board"` for a drain worker. */
  mode?: WorkerMaterializeMode;
  /**
   * One-line description for the direct-call tool (surfaced to the model).
   * Defaults to a generic hand-off description.
   */
  description?: string;
}

/**
 * Build the executable block for one worker entry.
 *
 * Dispatch order (parse-time mutual exclusion guarantees exactly one branch
 * fires): `blockRef` → `agentRef` → `promptRef` → `prompt`.
 */
export async function materializeWorker(
  workerKey: string,
  spec: WorkerSpec,
  deps: WorkerMaterializationDeps,
  opts: MaterializeWorkerOptions = {},
): Promise<BlockDefinition> {
  const mode = opts.mode ?? "direct";

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

  // 2. agent-ref — resolve a registered Agent via the injected registry.
  if (spec.agentRef !== undefined) {
    if (!deps.agentRegistry) {
      throw new Error(
        `Worker '${workerKey}' uses agent-ref '${spec.agentRef}' but no ` +
          `agentRegistry was supplied to materializeWorker. The delegation surface ` +
          `does not resolve agent-ref workers — use prompt/prompt-ref/block-ref, or ` +
          `supply an agentRegistry to whatever wires this board's workers.`,
      );
    }
    if (!deps.materializeAgent) {
      throw new Error(
        `Worker '${workerKey}' uses agent-ref '${spec.agentRef}' but no ` +
          `materializeAgent function was supplied to materializeWorker. The delegation ` +
          `surface does not resolve agent-ref workers — use prompt/prompt-ref/block-ref, ` +
          `or supply a materializeAgent to whatever wires this board's workers.`,
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

  // 3 & 4. prompt-ref / prompt — both build a generator with the substituted
  //        body as the system prompt.
  const baseBody = await resolvePromptBody(workerKey, spec, deps);
  const substituted = substitute(baseBody, { arguments: deps.input ?? "" });

  // `taskTools` in the tools array is shorthand for the capability. A worker
  // that lists it gets the eight addTask/…/listTasks tools. For a Shape 2
  // fan-out worker, resolve them against the drain board (deps.boardTaskTools);
  // otherwise the own-state singleton.
  const usesTaskTools = spec.tools?.includes("taskTools") ?? false;
  const taskToolsCap = deps.boardTaskTools ?? taskToolsCapability;
  const catalogToolKeys = spec.tools?.filter((t) => t !== "taskTools");
  const tools = resolveTools(workerKey, catalogToolKeys, deps.catalog);

  // Model resolution: per-worker `model:` wins, then the deps' default, then a
  // neutral `"intent/chat"` fallback so a delegation skill works out of the box.
  const modelId = spec.model ?? deps.defaultModelId ?? "intent/chat";

  if (mode === "board") {
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
      ...(usesTaskTools ? { uses: [taskToolsCap] as const } : {}),
    }) as unknown as BlockDefinition;
  }

  // direct mode — an LLM-facing `{ input }` tool named by the bare worker key.
  return buildDirectWorkerGenerator({
    workerKey,
    skillName: deps.skillName,
    body: substituted,
    modelId,
    tools,
    itemVisibility: spec.itemVisibility,
    usesTaskTools,
    taskToolsCap,
    ...(opts.description !== undefined ? { description: opts.description } : {}),
  });
}

/** Read the worker's prompt body — inline for `prompt`, file-read for `prompt-ref`. */
async function resolvePromptBody(
  workerKey: string,
  spec: WorkerSpec,
  deps: WorkerMaterializationDeps,
): Promise<string> {
  if (spec.prompt !== undefined) return spec.prompt;
  // Parser-enforced invariant: exactly one of the four resolution fields is set
  // on every WorkerSpec, and the caller has already dispatched block-ref /
  // agent-ref branches before reaching here.
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
 * Resolve a worker's `tools:` array against the catalog. Additive-not-
 * restrictive: unknown keys warn and drop rather than throw.
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
