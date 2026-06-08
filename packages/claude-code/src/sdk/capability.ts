/**
 * `createClaudeCodeAgentCapability` — host opt-in for the in-process Agent SDK.
 *
 * Mirrors `createClaudeCliCapability`: a single `tools` preset (on by default)
 * exposes the agent block to a generator, and the capability declares the
 * session-state schema (`sdkSessionId` + `sdkAgentRuns`) the block reads and
 * appends to. Installing this capability is the explicit declaration that a
 * process may run the Agent SDK in-process.
 */
import { defineCapability } from "@flow-state-dev/core";
import { z } from "zod";
import { claudeCodeAgent, type ClaudeCodeAgentOptions } from "./agent";
import {
  sdkAgentHandleSchema,
  type SdkAgentHandle,
} from "./types";

export interface CreateClaudeCodeAgentCapabilityOptions extends ClaudeCodeAgentOptions {}

/**
 * Create the Claude Code Agent SDK capability. Forwards all agent options
 * (resolver, session provider, model, HITL seam) to the underlying handler.
 * Has a single `tools` preset (on by default) carrying the agent block, and
 * declares the session-state schema the block depends on.
 */
export function createClaudeCodeAgentCapability(
  options: CreateClaudeCodeAgentCapabilityOptions = {},
) {
  const agent = claudeCodeAgent(options);

  return defineCapability({
    name: "claude-code-agent",
    sessionStateSchema: z.object({
      sdkSessionId: z.string().nullable().default(null),
      sdkAgentRuns: z.array(sdkAgentHandleSchema).default([] as SdkAgentHandle[]),
    }),
    presets: {
      tools: {
        tools: [agent],
      },
      default: ["tools"],
    },
  });
}
