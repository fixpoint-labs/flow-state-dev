/**
 * The shift coordinator's memory, added to its judgment turn and not to
 * `agent`. Read-side unless `capture` is set; the turn is told which.
 */
import type { GeneratorTool } from "@flow-state-dev/core";
import { defineCapability } from "@flow-state-dev/core";
import { system } from "@flow-state-dev/memory";

/** The recall tool's catalog key, the name a `tools:` line lists. */
export const RECALL_TOOL = "memory/recall";

/** What the turn's context says when capture is on. */
export const CAPTURE_ON =
  "Memory capture is on: after each answer, this conversation is recorded into your memory, so it can come back in a later conversation.";

/** What the turn's context says when capture is off. */
export const CAPTURE_OFF =
  "Memory capture is off: nothing said in this conversation is recorded into your memory. " +
  "If the person asks you to remember something for later, say you can't keep it.";

type AgentTurn = {
  catalog: Record<string, GeneratorTool>;
  uses: readonly unknown[];
};

/**
 * The agent's turn plus the standard memory pack (working memory, the rolling
 * digest, `memory/recall`).
 *
 * @param turn The agent's turn. Left unchanged for the `agent` flow.
 * @param options.model The model the recall tool and the capture pipeline run on.
 * @param options.capture Record each conversation into memory after each answer.
 */
export function coordinatorMemory<T extends AgentTurn>(turn: T, options: { model: string; capture: boolean }) {
  const mem = system({
    model: options.model,
    working: { capacity: 7 },
    episodic: true,
    semantic: true,
    digest: true,
  });
  return {
    ...turn,
    catalog: { ...turn.catalog, [RECALL_TOOL]: mem.tool.recall() as GeneratorTool },
    uses: [
      ...turn.uses,
      mem.capability,
      defineCapability({
        name: "memory-capture",
        presets: {
          line: { context: { memoryCapture: options.capture ? CAPTURE_ON : CAPTURE_OFF } },
          default: ["line"],
        },
      }),
    ],
    isolateUserState: true as const,
    ...(options.capture ? { afterAnswer: mem.captureFromItems } : {}),
  };
}
