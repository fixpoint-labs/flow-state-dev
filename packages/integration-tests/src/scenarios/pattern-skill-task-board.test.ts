/**
 * Pattern-skill + real task-board regression.
 *
 * Bisection step 2. The companion `pattern-skill-task-tools.test.ts`
 * proved a `uses: [taskToolsCapability]` generator can dispatch addTask
 * in isolation. This test wraps the same generator inside a real
 * `taskBoard()` with `concurrency: 4` — the production shape — so any
 * hang isolates to contention between the discoverer's addTask CAS
 * write and the 3 idle workers' poll-loop CAS writes against
 * `request.atomicState`.
 *
 * The mock fires one `addTask` and then a terminal text. If the run
 * completes, the bug needs something beyond contention (skill
 * activation nesting, multiple addTask in sequence, or the `runSkill`
 * router wrapping). If it hangs, the per-test timeout surfaces it as a
 * fast failure and we have the minimal reproducer.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import patternSkillTaskBoardFlow from "./fixtures/pattern-skill-task-board-flow";
import { itemsByType } from "../helpers/assertions";

describe("pattern-skill + task-board dispatch", () => {
  it(
    "completes the addTask lifecycle when a uses-capability generator runs inside a 4-worker board",
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
