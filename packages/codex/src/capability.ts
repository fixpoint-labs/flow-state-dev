/**
 * `createCodexAgentCapability` — host opt-in for running Codex in-process.
 *
 * Mirrors `createClaudeCodeAgentCapability` minus its session-state half: a
 * single `tools` preset (on by default) exposes the agent block to a generator,
 * and installing the capability is the explicit declaration that a process may
 * spawn Codex.
 *
 * **It declares no session state, and that is a decision rather than an
 * omission.** The thread a run continues belongs to the host, reached through
 * the `resume` resolver and written back through `onSession`, so this package
 * keeps none. A capability contributes its `sessionStateSchema` through a
 * channel a hand-off refusal's walk cannot see, so declaring one here would put
 * state nobody owns back into a flow through the one door that check is blind
 * to — the asymmetry the Claude Code capability documents at length.
 */
import { defineCapability } from "@flow-state-dev/core";
import type { DeclaredResourceEntry } from "@flow-state-dev/core/types";
import { codexAgent, type CodexAgentOptions } from "./agent";

/**
 * Create the Codex agent capability. Forwards every agent option to the
 * underlying handler — including the version gate, which therefore refuses here
 * too rather than at the first run.
 */
export function createCodexAgentCapability(options: CodexAgentOptions = {}) {
  const agent = codexAgent(options);
  const resources = promotedResources(agent);

  return defineCapability({
    name: "codex-agent",
    ...(Object.keys(resources).length > 0 ? { resources } : {}),
    presets: {
      tools: { tools: [agent] },
      default: ["tools"],
    },
  });
}

/**
 * The resource declarations the built agent block ended up with.
 *
 * They cannot stay where they were installed. `uses` puts them on the agent
 * handler, the handler is a tool inside this capability's preset, and a tool's
 * resources reach no flow — `mergeSurfaceInto` never reads a surface's `tools`
 * for them, and `collectBlockResources` gathers declarations from ACTION blocks
 * only. So the capability would be live at runtime with `ctx.resources` entries
 * resolving to nothing, and the route would 404 on a build that succeeded.
 *
 * **Read off the CONSTRUCTED block, not off the `uses` list.** Walking the list
 * and taking each reference's top-level `resources` sees only what a capability
 * declares at its own root: it misses resources an active preset contributes,
 * ones an open-config capability resolves when it is applied, and ones a nested
 * capability declares. `handler()` has already resolved all of that into
 * `declaredResources`, so asking the block is both simpler and complete.
 *
 * Dynamic `uses` entries still contribute nothing here, and that is the
 * framework's constraint rather than this function's: they resolve per call, and
 * a resource has to exist before the block runs. Two capabilities claiming one
 * accessor name is already the framework's refusal to make, at construction.
 */
function promotedResources(agent: {
  declaredResources?: Record<string, DeclaredResourceEntry>;
}): Record<string, DeclaredResourceEntry> {
  return { ...(agent.declaredResources ?? {}) };
}
