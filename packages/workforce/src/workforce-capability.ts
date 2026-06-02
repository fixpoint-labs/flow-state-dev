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
  // Eagerly validate: duplicate-name check runs at construction time.
  if (Array.isArray(options.agents)) {
    createAgentRegistry(options.agents);
  }

  // TODO: wire registry into capability presets for DevTool agent listing
  return defineCapability({
    name: "workforce",
  });
}
