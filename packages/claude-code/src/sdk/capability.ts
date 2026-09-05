/**
 * `createClaudeCodeAgentCapability` — host opt-in for the in-process Agent SDK.
 *
 * Mirrors `createClaudeCliCapability`: a single `tools` preset (on by default)
 * exposes the agent block to a generator, and the capability declares the
 * session-state schema (`sdkSessionId` + `sdkAgentRuns`) the block reads and
 * appends to. Installing this capability is the explicit declaration that a
 * process may run the Agent SDK in-process.
 *
 * `detached` is documented once, on the option itself in `./agent`.
 */
import { defineCapability } from "@flow-state-dev/core";
import type { DeclaredResourceEntry } from "@flow-state-dev/core/types";
import {
  claudeCodeAgent,
  claudeAgentSessionStateSchema,
  type ClaudeCodeAgentOptions,
} from "./agent";
import { workRecorderResources } from "./work-collections";

/**
 * Create the Claude Code Agent SDK capability. Forwards all agent options
 * (resolver, session provider, model, HITL seam) to the underlying handler.
 * Has a single `tools` preset (on by default) carrying the agent block, and
 * declares the session-state schema the block depends on.
 */
export function createClaudeCodeAgentCapability(options: ClaudeCodeAgentOptions = {}) {
  const { detached = false, recordWork = false } = options;
  const agent = claudeCodeAgent(options);
  const resources = {
    ...(recordWork ? workRecorderResources : {}),
    ...promotedResources(options.uses),
  };

  return defineCapability({
    name: "claude-code-agent",
    // Reuse the block's own schema so the capability never drifts from the
    // shape the handler reads and writes — and drop it on the same condition
    // the block does.
    //
    // Missing this half would LOOK like it worked. A capability contributes its
    // `sessionStateSchema` through a channel the hand-off refusal's walk cannot see:
    // the walk reads `config.sessionStateSchema` off composed blocks, and a
    // capability never writes onto its consumer's config. So a capability still
    // declaring the schema puts the key back through the one door the refusal
    // cannot check, and the flow accepts a handed-off worker carrying exactly
    // the collision that refusal exists to prevent.
    ...(detached ? {} : { sessionStateSchema: claudeAgentSessionStateSchema }),
    // Declared HERE, not inherited from the agent block below — and forwarding
    // the option alone is NOT enough, which is the failure this comment exists
    // to prevent recurring. The block sits in the capability's `tools` preset,
    // and three things line up against a tool's resources reaching the flow:
    // `mergeSurfaceInto` merges a capability surface's `resources` and never
    // reads `surface.tools` for them; `collectBlockResources` gathers
    // `declaredResources` from ACTION blocks, and a tool block is not one; and
    // `defineFlow`'s own comment settles it — "a generator is a leaf that
    // bubbles none of its tools' rails by design."
    //
    // So a capability whose only contribution is a resource-declaring block in
    // `tools` contributes NO resource declarations. The flow never registers the
    // refs, `findResourceConfig` misses, and the route answers 404 — at read
    // time, on a build that succeeded and tests that passed.
    //
    // This is the mirror of the asymmetry noted above for `sessionStateSchema`:
    // there a capability contributes through a channel the task board's walk
    // cannot see, here its tools contribute through a channel the flow's
    // collector cannot see. Both directions of that seam now carry a note.
    //
    // Which is also why a capability handed through `uses` has its resources
    // promoted here rather than left on the agent block: installed there, it
    // sits in the `tools` preset and hits the same wall.
    ...(Object.keys(resources).length > 0 ? { resources } : {}),
    presets: {
      tools: {
        tools: [agent],
      },
      default: ["tools"],
    },
  });
}

/**
 * The resource declarations of the statically-listed `uses` capabilities.
 *
 * They cannot stay where they were installed. `uses` puts them on the agent
 * handler, the handler is a tool inside this capability's preset, and a tool's
 * resources reach no flow — the long note above traces why. So the capability
 * would be present at runtime with `ctx.resources` entries that resolve to
 * nothing, and the route would 404 on a build that succeeded.
 *
 * Dynamic entries are skipped: they resolve per-call, and a resource has to
 * exist before the block runs. That constraint is `UsesEntry`'s own.
 *
 * Two capabilities claiming one accessor name is already the framework's
 * refusal to make, and it makes it by name at construction.
 */
function promotedResources(
  uses: ClaudeCodeAgentOptions["uses"],
): Record<string, DeclaredResourceEntry> {
  const out: Record<string, DeclaredResourceEntry> = {};
  for (const entry of uses ?? []) {
    if (typeof entry === "function") continue;
    const declared = (entry as { resources?: Record<string, DeclaredResourceEntry> }).resources;
    Object.assign(out, declared ?? {});
  }
  return out;
}
