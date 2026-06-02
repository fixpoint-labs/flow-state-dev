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
import { createAgentRegistry } from "./agent-registry";

export interface WorkforceCapabilityOptions {
  agents: Agent[] | AgentRegistry;
  catalog?: ToolCatalog;
}

export function createWorkforceCapability(
  options: WorkforceCapabilityOptions,
): DefinedCapability {
  const _registry = Array.isArray(options.agents)
    ? createAgentRegistry(options.agents)
    : options.agents;

  return defineCapability({
    name: "workforce",
  });
}
