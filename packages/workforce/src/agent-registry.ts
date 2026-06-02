/**
 * `createAgentRegistry` — in-memory agent catalog satisfying the core AgentRegistry interface.
 * Errors on duplicate names at construction time.
 */

import type { Agent, AgentRegistry } from "@flow-state-dev/core";

export function createAgentRegistry(agents: Agent[]): AgentRegistry {
  const byName = new Map<string, Agent>();
  for (const agent of agents) {
    if (byName.has(agent.name)) {
      throw new Error(
        `createAgentRegistry: duplicate agent name "${agent.name}"`,
      );
    }
    byName.set(agent.name, agent);
  }

  return {
    get: async (name) => byName.get(name),
    list: async () => Array.from(byName.values()),
  };
}
