/**
 * `agentBlock` — invoke an Agent as a standalone block in any flow.
 * Thin wrapper around materializeAgent with standalone shape.
 */

import type {
  Agent,
  DefinedCapability,
  ToolCatalog,
} from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { materializeAgent } from "./materialize-agent";

export interface AgentBlockOptions {
  catalog?: ToolCatalog;
  capabilityCatalog?: Record<string, DefinedCapability>;
  defaultModelId?: string;
}

export function agentBlock(
  agent: Agent,
  opts?: AgentBlockOptions,
): BlockDefinition {
  return materializeAgent(agent, {
    catalog: opts?.catalog ?? {},
    capabilityCatalog: opts?.capabilityCatalog,
    defaultModelId: opts?.defaultModelId,
    shape: "standalone",
  });
}
