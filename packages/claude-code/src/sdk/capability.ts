/**
 * `createClaudeCodeAgentCapability` — host opt-in for the in-process Agent SDK.
 *
 * Mirrors `createClaudeCliCapability`: a single `tools` preset (on by default)
 * exposes the agent block to a generator, and the capability declares the
 * session-state schema (`sdkSessionId` + `sdkAgentRuns`) the block reads and
 * appends to. Installing this capability is the explicit declaration that a
 * process may run the Agent SDK in-process.
 *
 * `sessionState` is documented once, on the option itself in `./agent`.
 */
import { defineCapability } from "@flow-state-dev/core";
import {
  claudeCodeAgent,
  claudeAgentSessionStateSchema,
  type ClaudeCodeAgentOptions,
} from "./agent";

/**
 * Create the Claude Code Agent SDK capability. Forwards all agent options
 * (resolver, session provider, model, HITL seam) to the underlying handler.
 * Has a single `tools` preset (on by default) carrying the agent block, and
 * declares the session-state schema the block depends on.
 */
export function createClaudeCodeAgentCapability(options: ClaudeCodeAgentOptions = {}) {
  const { sessionState = true } = options;
  const agent = claudeCodeAgent(options);

  return defineCapability({
    name: "claude-code-agent",
    // Reuse the block's own schema so the capability never drifts from the
    // shape the handler reads and writes — and drop it on the same condition
    // the block does.
    //
    // Missing this half would LOOK like it worked. A capability contributes its
    // `sessionStateSchema` through a channel the task board's walk cannot see:
    // the walk reads `config.sessionStateSchema` off composed blocks, and a
    // capability never writes onto its consumer's config. So a capability still
    // declaring the schema puts the key back through the one door the refusal
    // cannot check, and the board accepts a detached worker carrying exactly
    // the collision that refusal exists to prevent.
    ...(sessionState ? { sessionStateSchema: claudeAgentSessionStateSchema } : {}),
    presets: {
      tools: {
        tools: [agent],
      },
      default: ["tools"],
    },
  });
}
