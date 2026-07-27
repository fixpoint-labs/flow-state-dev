/**
 * `materializeAgent` — build a worker-shaped or standalone generator from a
 * resolved Agent. Satisfies `MaterializeAgentFn` so it can be injected into
 * PatternRegistryDeps without skills depending on workforce.
 */

import {
  generator,
  type GeneratorTool,
  type MaterializeAgentFn,
  type MaterializeAgentOptions,
  type Agent,
  type DefinedCapability,
} from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  workerInputSchema,
  buildUserMessage,
  taskTools as taskToolsCapability,
} from "@flow-state-dev/orchestration";
import { resolveAgentPersona } from "./resolve-persona";

function resolveCatalogTools(
  agentName: string,
  toolKeys: readonly string[] | undefined,
  catalog: Record<string, GeneratorTool>,
): GeneratorTool[] {
  if (!toolKeys || toolKeys.length === 0) return [];
  const out: GeneratorTool[] = [];
  for (const key of toolKeys) {
    const tool = catalog[key];
    if (!tool) {
      console.warn(
        `[workforce] agent "${agentName}": unknown tool "${key}" — skipped`,
      );
      continue;
    }
    out.push(tool);
  }
  return out;
}

function resolveCapabilities(
  agentName: string,
  entries: ReadonlyArray<string | DefinedCapability> | undefined,
  catalog: Record<string, DefinedCapability> | undefined,
): DefinedCapability[] {
  if (!entries || entries.length === 0) return [];
  const out: DefinedCapability[] = [];
  for (const entry of entries) {
    // A string is a catalog key (registry-resolved); a capability reference
    // (base or `.with()`-configured) is used as-is — refs need no catalog.
    if (typeof entry === "string") {
      // No catalog → a string key can't be resolved; skip SILENTLY, preserving
      // the pre-FIX-732 behavior for string-key agents materialized without a
      // capabilityCatalog (the change stays purely additive). The warn below
      // fires only when a catalog IS present but the key is unknown.
      if (!catalog) continue;
      const cap = catalog[entry];
      if (!cap) {
        console.warn(
          `[workforce] agent "${agentName}": unknown capability "${entry}" — skipped`,
        );
        continue;
      }
      out.push(cap);
    } else {
      out.push(entry);
    }
  }
  return out;
}

function buildAgentGenerator(
  agent: Agent,
  opts: MaterializeAgentOptions,
): BlockDefinition {
  const model =
    opts.overrides?.model ?? agent.model ?? opts.defaultModelId ?? "intent/chat";
  const itemVisibility =
    opts.overrides?.itemVisibility ??
    agent.itemVisibility ??
    { client: true, history: false };

  const toolKeys = opts.overrides?.tools ?? agent.allowedTools;
  const usesTaskTools = toolKeys?.includes("taskTools") ?? false;
  const catalogKeys = toolKeys?.filter((t) => t !== "taskTools");
  const tools = resolveCatalogTools(agent.name, catalogKeys, opts.catalog);

  const resolvedUses = resolveCapabilities(
    agent.name,
    agent.usesCapabilities,
    opts.capabilityCatalog,
  );
  // A worker that declares taskTools for mid-drain fan-out needs them bound to
  // the active drain board (opts.boardTaskTools), not the process-wide singleton
  // which looks at no board. Fall back to the singleton when no board capability
  // was supplied (standalone / non-delegation callers keep working unchanged).
  const uses = [
    ...resolvedUses,
    ...(usesTaskTools ? [opts.boardTaskTools ?? taskToolsCapability] : []),
  ];

  // A worker declaring taskTools with no board capability falls back to the
  // empty singleton, which fails at drain with `no_delegation_board`. Surface
  // it at materialization time instead. Scoped to workers (standalone agents
  // legitimately have no board). Fires in every environment, matching the
  // usesSkills/contextMode warnings below — this misconfiguration is worth
  // surfacing in production too, not just dev.
  if (opts.shape === "worker" && usesTaskTools && !opts.boardTaskTools) {
    console.warn(
      `[workforce] agent "${agent.name}": worker declares taskTools but no ` +
        `boardTaskTools was supplied — fan-out tools will target the empty ` +
        `singleton board (no_delegation_board at drain).`,
    );
  }

  if (agent.usesSkills?.length) {
    console.warn(
      `[workforce] agent "${agent.name}": usesSkills is reserved and not yet wired — ignored`,
    );
  }

  if (agent.contextMode === "fork") {
    console.warn(
      `[workforce] agent "${agent.name}": contextMode "fork" is not honored — composing inline`,
    );
  }

  const isWorker = opts.shape === "worker";

  if (isWorker) {
    if (!opts.skillName) {
      throw new Error(
        `materializeAgent: worker shape requires skillName (agent "${agent.name}")`,
      );
    }
    if (!opts.workerKey) {
      throw new Error(
        `materializeAgent: worker shape requires workerKey (agent "${agent.name}")`,
      );
    }
  }

  return generator({
    name: isWorker
      ? `skillWorker_${opts.skillName}_${opts.workerKey}`
      : `agent_${agent.name}`,
    itemVisibility,
    agentName: agent.name,
    inputSchema: isWorker ? workerInputSchema : z.object({ goal: z.string() }),
    // Standalone agents honor a declared structured outputSchema; workers stay
    // z.string() (the skills pattern machinery builds follow-on actions from text).
    outputSchema: !isWorker && agent.outputSchema ? agent.outputSchema : z.string(),
    model,
    prompt: (_input: unknown, ctx: unknown) =>
      resolveAgentPersona(agent.persona, ctx as any),
    user: isWorker
      ? (input: any) => buildUserMessage(input)
      : (input: any) => input.goal,
    ...(tools.length ? { tools } : {}),
    ...(uses.length ? { uses } : {}),
    maxIterations: 12,
  }) as unknown as BlockDefinition;
}

export const materializeAgent: MaterializeAgentFn = (agent, opts) =>
  buildAgentGenerator(agent, opts);
