/**
 * `createCursorAgentCapability` — host opt-in for running Cursor in-process.
 *
 * Mirrors `createCodexAgentCapability`: a single `tools` preset (on by default)
 * exposes the agent block to a generator, and installing the capability is the
 * explicit declaration that a process may start Cursor's local runtime.
 *
 * **It declares no session state, and that is a decision rather than an
 * omission.** The agent a run continues belongs to the host, reached through the
 * `resume` resolver and written back through `onSession`, so this package keeps
 * none. A capability contributes its `sessionStateSchema` through a channel a
 * dispatch refusal's walk cannot see, so declaring one here would put state
 * nobody owns back into a flow through the one door that check is blind to — the
 * asymmetry the Claude Code capability documents at length.
 */
import { defineCapability } from "@flow-state-dev/core";
import { cursorAgent, type CursorAgentOptions } from "./agent";

/**
 * Create the Cursor agent capability. Forwards every agent option to the
 * underlying handler — including the version gate, which therefore refuses here
 * too rather than at the first run.
 */
export function createCursorAgentCapability(options: CursorAgentOptions = {}) {
  const agent = cursorAgent(options);
  // Preset tools do not register their resources on the flow. The built handler has
  // already resolved its own declarations and statically installed capabilities.
  const resources = { ...agent.declaredResources };

  return defineCapability({
    name: "cursor-agent",
    ...(Object.keys(resources).length > 0 ? { resources } : {}),
    presets: {
      tools: { tools: [agent] },
      default: ["tools"],
    },
  });
}
