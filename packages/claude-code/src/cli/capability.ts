/**
 * `createClaudeCliCapability` — host opt-in for `claude --remote` dispatch.
 *
 * Installing this capability via `uses` is the explicit declaration that a
 * process may shell out to `claude`; nothing dispatches otherwise. The `tools`
 * preset exposes the dispatch handler to a generator so the model can choose to
 * dispatch, while the same handler is also usable directly as a sequencer step.
 */
import { defineCapability } from "@flow-state-dev/core";
import { claudeRemoteDispatch, type ClaudeRemoteDispatchOptions } from "./dispatch";

export interface CreateClaudeCliCapabilityOptions extends ClaudeRemoteDispatchOptions {}

/**
 * Create the Claude CLI capability. Forwards all dispatch options (resolver,
 * cwd, timeout) to the underlying handler. Has a single `tools` preset (on by
 * default) carrying the dispatch block.
 */
export function createClaudeCliCapability(options: CreateClaudeCliCapabilityOptions = {}) {
  const dispatch = claudeRemoteDispatch(options);

  return defineCapability({
    name: "claude-cli",
    presets: {
      tools: {
        tools: [dispatch],
      },
      default: ["tools"],
    },
  });
}
