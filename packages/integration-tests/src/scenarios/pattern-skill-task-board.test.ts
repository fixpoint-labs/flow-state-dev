/**
 * `taskTools` capability + real task-board composition.
 *
 * A `uses: [taskTools]` generator runs inside a production-shape
 * `taskBoard()` with `concurrency: 4`. The mock fires one `addTask` and then
 * a terminal text; the board drains its seeded task. The guard is that this
 * composition of surviving primitives (the task-board substrate and the
 * agent-callable `taskTools` surface) completes without hanging — any
 * regression surfaces as a fast per-test timeout failure. Skill pattern/fork
 * modes were removed in FIX-918; the board here is wired directly, not via a
 * skill.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import patternSkillTaskBoardFlow from "./fixtures/pattern-skill-task-board-flow";
import { itemsByType } from "../helpers/assertions";

describe("taskTools + task-board composition", () => {
  it(
    "completes when a uses-taskTools generator runs inside a 4-worker board",
    async () => {
      const result = await testFlow({
        flow: patternSkillTaskBoardFlow,
        action: "run",
        userId: "test-user",
        input: { message: "Discover for example.com" },
        generators: {
          "tb-discoverer": mockGenerator({
            name: "tb-discoverer",
            script: [
              {
                toolCalls: [
                  {
                    toolCallId: "tc_add_1",
                    toolName: "addTask",
                    args: {
                      goal: "Analyze acme.example",
                      assignee: "analyzer"
                    }
                  }
                ]
              },
              { text: "Queued one analyzer task." }
            ]
          })
        },
        unmockedGeneratorPolicy: "error"
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe("completed");

      const toolOutputs = itemsByType(result.items, "tool_output").filter(
        (item) => item.toolCall?.name === "addTask"
      );
      expect(toolOutputs).toHaveLength(1);
      expect(toolOutputs[0]!.status).not.toBe("in_progress");
    },
    15_000
  );
});
