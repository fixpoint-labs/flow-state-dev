/**
 * The names standing rules pin (FIX-1945): the rule tools, the rules action,
 * the `agentName` a rule write's line carries, and the flows that keep rules.
 * Imports only other leaves, so the browser entry, the client and the server
 * half share one spelling.
 */
import { COORDINATOR_FLOW } from "../coordinator/coordinator-keys";
import { AGENT_FLOW } from "../workers/keys";

/** The four rule tools' names. **Pinned**: model-facing, and named in the docs. */
export const RULE_TOOLS = {
  read: "rules/read",
  add: "rules/add",
  change: "rules/change",
  remove: "rules/remove"
} as const;

/** The action a page reads and edits a worker's rules through, on the worker's own flow. */
export const STANDING_RULES_ACTION = "standingRules";

/** The `agentName` the line a rule write posts carries, so a renderer can tell it from a reply. */
export const STANDING_RULES_LINE = "standing-rules";

/**
 * The worker flows that keep standing rules: the built-in agent flow and the
 * coordinator, the two that compose the rules capability and declare the
 * rules action. A worker on any other flow keeps none.
 */
export const STANDING_RULES_FLOWS: readonly string[] = [AGENT_FLOW, COORDINATOR_FLOW];
