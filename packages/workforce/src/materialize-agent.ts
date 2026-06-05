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
} from "@flow-state-dev/skills";
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
    // (base or `.presets()`-configured) is used as-is — refs need no catalog.
    if (typeof entry === "string") {
      const cap = catalog?.[entry];
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
  const uses = [
    ...resolvedUses,
    ...(usesTaskTools ? [taskToolsCapability] : []),
  ];

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
