/**
 * Agent → board-worker materialization for delegation skills (FIX-918).
 *
 * Given a parsed `AgentSpec` (one of `prompt`, `promptRef`, `agentRef`), build a
 * `BlockDefinition` the delegation board dispatches by `task.assignee`. Every
 * declared agent becomes a **board worker**: its `inputSchema` is the
 * substrate's `workerInputSchema` (`taskId`/`goal`/`attempts`/…) and its name is
 * namespaced (`skillWorker_<skill>_<key>`), matching what the board drain feeds.
 * There is no direct-call (host-tool) mode — work reaches an agent only by being
 * assigned as a task and drained (see `delegation-surface.ts`).
 *
 * Inline agents (`prompt`/`prompt-ref`) build a generator with the substituted
 * body as the system prompt; the `agentRef` branch resolves a registered Agent
 * through the injected registry + `materializeAgent`.
 */

import {
  generator,
  warnOnceDev,
  type GeneratorTool,
} from "@flow-state-dev/core";
import type {
  AgentRegistry,
  AgentSpec,
  DefinedCapability,
  MaterializeAgentFn,
  ToolCatalog,
} from "@flow-state-dev/core";
import type {
  BlockDefinition,
  ResourceCollectionRef,
} from "@flow-state-dev/core/types";
import { z } from "zod";
import type { TaskWorkerInput } from "../tasks";
import { taskWorkerInputSchema } from "../task-board";
import { skillFileKey } from "./collection";
import { stripFrontmatter } from "./internal/strip-frontmatter";
import { substitute } from "./skill-md";
import { taskTools as taskToolsCapability } from "./task-tools-capability";

/**
 * Dependencies for materializing a skill's agents into board workers.
 */
export interface WorkerMaterializationDeps {
  /** Tool catalog. Inline agents resolve their `tools:` field against this. */
  catalog: ToolCatalog;
  /**
   * Optional agent registry consumed by `agent-ref` agents. When undefined,
   * any agent using `agent-ref` fails with a "no registry configured" error.
   */
  agentRegistry?: AgentRegistry;
  /** Optional capability catalog forwarded to `materializeAgent`. */
  capabilityCatalog?: Record<string, DefinedCapability>;
  /** Injected materializer that turns a resolved Agent into a worker generator. */
  materializeAgent?: MaterializeAgentFn;
  /** Skill name — used for the board worker block name. */
  skillName: string;
  /**
   * Skill resource collection — supports `prompt-ref` reads. Optional: a
   * caller that pre-resolves prompt bodies (bundled skill files) may omit it;
   * a `prompt-ref` agent that still needs a read fails with a clear message.
   */
  skillCollection?: ResourceCollectionRef;
  /** Default model id when an agent omits its own `model`. */
  defaultModelId?: string;
  /** Activation input ($ARGUMENTS substitution context). */
  input?: string;
  /**
   * Optional board-bound `taskTools` capability for an inline agent that itself
   * declares `tools: [taskTools]` (mid-drain fan-out). When set, the agent's
   * `taskTools` resolve against the drain board it was dispatched from rather
   * than the singleton's own-state default. When unset, the singleton is used.
   */
  boardTaskTools?: DefinedCapability;
}

/**
 * Board-worker input schema. The worker-input shape is owned by the task-board
 * substrate (`taskWorkerInputSchema`) — the board dispatch feeds it — so this is
 * a re-export rather than a second definition that could drift (FIX-928, D2).
 * The substrate schema is a compatible superset (adds optional `title`/`context`,
 * stricter `attempts: int().nonnegative()`); the extra optionals are accepted,
 * not required, so both importers of this alias keep working.
 */
export const workerInputSchema = taskWorkerInputSchema;

type WorkerInput = TaskWorkerInput;

/**
 * Turn window a `contextSupply: "conversation"` agent inherits (FIX-920).
 *
 * `conversation` ships **bounded by default** per the delegation-substrate epic
 * (FIX-930): rather than inheriting the full history window (~50 turns), the
 * worker's `history` slot is bounded to the last N whole turns using the real
 * `ItemQuery.limit` shape (`{ limit: { turns: N } }`, not `{ turns: N }`). This
 * caps the token / latency cost of feeding prior conversation into a delegated
 * agent; a per-agent override is a documented future extension.
 *
 * Note the bound is a **turn** count, not a token budget: N whole turns of very
 * long messages can still be a lot of tokens. It caps how many turns flow in,
 * not their size.
 */
export const CONVERSATION_HISTORY_TURNS = 8;

/**
 * Build the executable board worker for one agent entry.
 *
 * Dispatch order (parse-time mutual exclusion guarantees exactly one branch
 * fires): `agentRef` → `promptRef` → `prompt`.
 */
export async function materializeWorker(
  agentKey: string,
  spec: AgentSpec,
  deps: WorkerMaterializationDeps,
): Promise<BlockDefinition> {
  // FIX-920: validate `contextSupply` here, not only in the frontmatter parser.
  // `AgentSpec`/`materializeWorker` are exported and persisted `PatternBinding`s
  // are only shallowly revalidated, so a programmatic or persisted spec bypasses
  // `parseAgentSpec`. This is the authoritative guard — it covers (a) an
  // out-of-enum value (which would otherwise fall through the `=== "conversation"`
  // check below and silently run isolated) and (b) `contextSupply` on an
  // `agentRef` agent (whose context is owned by the workforce materializer, not
  // reachable from this history slot). `"conversation"` is the only value;
  // isolation is the default, expressed by omitting the field (no sentinel).
  if (spec.contextSupply !== undefined) {
    if (spec.contextSupply !== "conversation") {
      throw new Error(
        `Agent '${agentKey}': invalid context-supply '${String(spec.contextSupply)}' ` +
          `— the only value is "conversation"; omit the field for the default (isolated).`,
      );
    }
    if (spec.agentRef !== undefined) {
      throw new Error(
        `Agent '${agentKey}': context-supply applies to prompt/prompt-ref agents; ` +
          `agent-ref agents own their own context (resolved through the agent registry).`,
      );
    }
  }

  // 1. agent-ref — resolve a registered Agent via the injected registry.
  if (spec.agentRef !== undefined) {
    if (!deps.agentRegistry) {
      throw new Error(
        `Agent '${agentKey}' uses agent-ref '${spec.agentRef}' but no ` +
          `agentRegistry was supplied to materializeWorker. The delegation surface ` +
          `does not resolve agent-ref agents — use prompt/prompt-ref, or ` +
          `supply an agentRegistry to whatever wires this board's workers.`,
      );
    }
    if (!deps.materializeAgent) {
      throw new Error(
        `Agent '${agentKey}' uses agent-ref '${spec.agentRef}' but no ` +
          `materializeAgent function was supplied to materializeWorker. The delegation ` +
          `surface does not resolve agent-ref agents — use prompt/prompt-ref, ` +
          `or supply a materializeAgent to whatever wires this board's workers.`,
      );
    }
    const agent = await deps.agentRegistry.get(spec.agentRef);
    if (!agent) {
      const registered = (await deps.agentRegistry.list()).map((a) => a.name);
      throw new Error(
        `Agent '${agentKey}' references agent '${spec.agentRef}' which is not in the registry. ` +
          `Registered agents: ${registered.join(", ") || "(none)"}.`,
      );
    }
    return deps.materializeAgent(agent, {
      catalog: deps.catalog,
      capabilityCatalog: deps.capabilityCatalog,
      defaultModelId: deps.defaultModelId,
      overrides: spec.agentOverrides,
      shape: "worker",
      workerKey: agentKey,
      skillName: deps.skillName,
      // Mirror the inline branch: hand the agent-ref worker the same board-bound
      // taskTools so mid-drain fan-out lands on the active drain board rather
      // than the empty singleton (which fails with `no_delegation_board`).
      boardTaskTools: deps.boardTaskTools,
    });
  }

  // 2 & 3. prompt-ref / prompt — both build a generator with the substituted
  //        body as the system prompt.
  const baseBody = await resolvePromptBody(agentKey, spec, deps);
  const substituted = substitute(baseBody, { arguments: deps.input ?? "" });

  // `taskTools` in the tools array is shorthand for the capability. An agent
  // that lists it gets the eight addTask/…/listTasks tools. For a mid-drain
  // fan-out agent, resolve them against the drain board (deps.boardTaskTools);
  // otherwise the own-state singleton.
  const usesTaskTools = spec.tools?.includes("taskTools") ?? false;
  const taskToolsCap = deps.boardTaskTools ?? taskToolsCapability;
  const catalogToolKeys = spec.tools?.filter((t) => t !== "taskTools");
  const tools = resolveTools(agentKey, catalogToolKeys, deps.catalog);

  // Model resolution: per-agent `model:` wins, then the deps' default, then a
  // neutral `"intent/chat"` fallback so a delegation skill works out of the box.
  const modelId = spec.model ?? deps.defaultModelId ?? "intent/chat";

  // FIX-920: a `conversation` agent inherits the parent conversation via the
  // generator `history` slot, bounded to the last N whole turns. Output
  // isolation (below) is independent — the agent reads prior history but its
  // own steps still stay out of host history. If the author also made output
  // history-visible, that isolation is defeated: warn, don't silently proceed.
  const inheritsConversation = spec.contextSupply === "conversation";
  if (inheritsConversation && spec.itemVisibility?.history === true) {
    // `buildDelegationTools` re-materializes every worker on each generator
    // execution, so a raw console.warn here fires once per step. Collapse it to
    // one emission per (skill, agent) config via the shared warn-once helper.
    warnOnceDev(
      `skills:context-supply-history-visible:${deps.skillName}:${agentKey}`,
      `[skills] agent "${agentKey}": context-supply "conversation" with ` +
        `history-visible output — the sub-work re-enters host history, so it is ` +
        `no longer isolated.`,
    );
  }

  return generator({
    name: `skillWorker_${deps.skillName}_${agentKey}`,
    itemVisibility: spec.itemVisibility ?? { client: true, history: false },
    ...(inheritsConversation
      ? { history: { limit: { turns: CONVERSATION_HISTORY_TURNS } } }
      : {}),
    agentName: `skill-${deps.skillName}-${agentKey}`,
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

/** Read the agent's prompt body — inline for `prompt`, file-read for `prompt-ref`. */
async function resolvePromptBody(
  agentKey: string,
  spec: AgentSpec,
  deps: WorkerMaterializationDeps,
): Promise<string> {
  if (spec.prompt !== undefined) return spec.prompt;
  // Parser-enforced invariant: exactly one of the resolution fields is set on
  // every AgentSpec, and the caller has already dispatched the agent-ref branch
  // before reaching here.
  const promptRef = spec.promptRef!;
  if (!deps.skillCollection) {
    throw new Error(
      `Agent '${agentKey}': prompt-ref '${promptRef}' needs the skills collection to ` +
        `read from, but none was supplied (and the body was not pre-resolved from bundled files)`,
    );
  }
  const key = skillFileKey(deps.skillName, promptRef);
  const ref = await deps.skillCollection.getOptional(key);
  if (!ref) {
    throw new Error(
      `Agent '${agentKey}': prompt-ref '${promptRef}' not found in skill folder (resolved key: ${key})`,
    );
  }
  const content = (await ref.readContent()) ?? "";
  return stripFrontmatter(content);
}

/**
 * Resolve an agent's `tools:` array against the catalog. Additive-not-
 * restrictive: unknown keys warn and drop rather than throw.
 */
function resolveTools(
  agentKey: string,
  toolKeys: readonly string[] | undefined,
  catalog: Record<string, GeneratorTool>,
): GeneratorTool[] {
  if (!toolKeys || toolKeys.length === 0) return [];
  const out: GeneratorTool[] = [];
  for (const key of toolKeys) {
    // BP-031: `key` comes from the agent's declared `tools:` list, which
    // `skill-md.ts` parses as a bare string list with no per-entry validation,
    // so an `[]` lookup against the plain-object catalog could resolve
    // inherited `Object.prototype` members (e.g. "constructor", "toString")
    // instead of a real tool. Require an own property before indexing
    // (FIX-965; same guard as `dispatch-and-execute.ts`, FIX-943).
    if (!Object.hasOwn(catalog, key)) {
      console.warn(
        `[skills] agent "${agentKey}": unknown tool "${key}" — skipped`,
      );
      continue;
    }
    out.push(catalog[key]!);
  }
  return out;
}

/** Build the per-invocation user turn from the substrate's TaskWorkerInput. */
export function buildUserMessage(input: WorkerInput): string {
  const parts: string[] = [`Task: ${input.goal}`];
  // The structured payload the planner attached via `addTask({ input })`. It is
  // advertised in the addTask tool description as "handed to the worker," so it
  // must actually reach the worker's turn — not just sit on the task record.
  if (input.input !== undefined && input.input !== null) {
    const rendered =
      typeof input.input === "string"
        ? input.input
        : JSON.stringify(input.input, null, 2);
    parts.push("", `Input: ${rendered}`);
  }
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
