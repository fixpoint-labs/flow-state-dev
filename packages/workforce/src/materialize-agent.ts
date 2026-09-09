/**
 * `materializeAgent` — build a worker-shaped or standalone generator from a
 * resolved Agent. Satisfies `MaterializeAgentFn` so it can be injected into
 * PatternRegistryDeps without skills depending on workforce.
 */

import {
  generator,
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
  resolveCatalogTools,
  taskTools as taskToolsCapability,
} from "@flow-state-dev/orchestration";
import { resolveAgentPersona } from "./resolve-persona";
import { AgentCapabilityError } from "./errors";

function resolveCapabilities(
  agentName: string,
  entries: ReadonlyArray<string | DefinedCapability> | undefined,
  catalog: Record<string, DefinedCapability> | undefined,
): DefinedCapability[] {
  if (!entries || entries.length === 0) return [];
  const out: DefinedCapability[] = [];
  for (const entry of entries) {
    // A string is a catalog key (registry-resolved); a capability reference
    // (base, `.with()`- or `.presets()`-configured) is used as-is — refs need
    // no catalog and are never refused.
    if (typeof entry === "string") {
      // No catalog → refuse (FIX-1327): nowhere to resolve against, so the
      // agent used to run without a capability it declared, silently. The
      // unknown-key miss below stays warn-and-drop — the same additive policy
      // `resolveCatalogTools` states for tools; change both or neither.
      if (!catalog) {
        throw new AgentCapabilityError(
          `materializeAgent: agent "${agentName}" declares capability "${entry}" as a ` +
            `catalog key, but no capabilityCatalog was supplied. Supply one to whatever ` +
            `materializes this agent, or put the capability reference itself in ` +
            `usesCapabilities.`,
          { agentName, capability: entry },
        );
      }
      // Same own-property requirement as the tool catalog above (FIX-965).
      if (!Object.hasOwn(catalog, entry)) {
        console.warn(
          `[workforce] agent "${agentName}": unknown capability "${entry}" — skipped`,
        );
        continue;
      }
      out.push(catalog[entry]!);
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
  const tools = resolveCatalogTools(
    agent.name,
    catalogKeys,
    opts.catalog,
    "workforce",
  );

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
