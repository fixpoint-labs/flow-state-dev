/**
 * `createWorkforceCapability` — optional capability for standalone provisioning.
 * Surfaces agents in the capability system for DevTool discoverability.
 */

import {
  defineCapability,
  type Agent,
  type AgentRegistry,
  type DefinedCapability,
  type ToolCatalog,
} from "@flow-state-dev/core";

export interface WorkforceCapabilityOptions {
  agents: Agent[] | AgentRegistry;
  catalog?: ToolCatalog;
}

export function createWorkforceCapability(
  options: WorkforceCapabilityOptions,
): DefinedCapability {
  // Eagerly validate: the duplicate-name check runs at construction time, so a
  // roster with two agents under one name is refused where it is declared
  // rather than at the first ambiguous lookup. Inlined because this is the only
  // caller — a shared registry helper for one check would be indirection.
  if (Array.isArray(options.agents)) {
    const seen = new Set<string>();
    for (const agent of options.agents) {
      if (seen.has(agent.name)) {
        throw new Error(
          `createWorkforceCapability: duplicate agent name "${agent.name}"`,
        );
      }
      seen.add(agent.name);
    }
  }

  // TODO: wire registry into capability presets for DevTool agent listing
  return defineCapability({
    name: "workforce",
  });
}
