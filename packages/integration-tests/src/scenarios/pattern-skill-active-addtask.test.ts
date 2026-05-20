/**
 * Pattern-skill `addTask` with a live active-skill session entry —
 * bisection step 3.
 *
 * The two prior tests proved `uses: [taskToolsCapability]` dispatch works
 * in isolation and inside a 4-worker taskBoard. Both let `addTask` exit
 * early with `no_active_pattern` because the test ctx had no
 * `session.state.activeSkills` entry — so the handler never executed the
 * real CAS write. This test seeds `activeSkills` so `getActivePatternCollection`
 * resolves to the live board's collection, forcing `collection.addTask` to
 * contend with the 3 idle workers' poll-loop CAS writes against
 * `request.atomicState`.
 *
 * Reuses the fixture from `pattern-skill-task-board-flow.ts` (4 workers,
 * request-backed collection at stateKey `skill_test_board_collection`).
 * The seeded entry's `collectionId` must match the fixture's stateKey so
 * the capability hits the same slot the board owns.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import patternSkillTaskBoardFlow from "./fixtures/pattern-skill-task-board-flow";
import { itemsByType } from "../helpers/assertions";

describe("pattern-skill addTask under live active-skill + 4-worker contention", () => {
  it(
    "completes the addTask lifecycle when activeSkills entry points at the live board collection",
    async () => {
      const collectionId = "skill_test_board_collection";

      const result = await testFlow({
        flow: patternSkillTaskBoardFlow,
        action: "run",
        userId: "test-user",
        input: { message: "Discover for example.com" },
        seed: {
          session: {
            state: {
              activeSkills: [
                {
                  name: "test-board",
                  mode: "pattern",
                  activatedAt: Date.now(),
                  pattern: {
                    patternKey: "task-board",
                    collectionId,
                    backing: "request"
                  }
                }
              ]
            }
          }
        },
        generators: {
          "tb-discoverer": mockGenerator({
            name: "tb-discoverer",
            script: [
              // Production interleaves several search calls before any
              // addTask. The 5 searches take real seconds — during which
              // the 3 idle workers spin claim-task / check-board at
              // 50ms intervals against the same request scope. Mirror
              // that shape: 5 searches, then 4 addTask, then a text.
              {
                toolCalls: [
                  { toolCallId: "tc_s_1", toolName: "search", args: { query: "competitor 1" } },
                  { toolCallId: "tc_s_2", toolName: "search", args: { query: "competitor 2" } },
                  { toolCallId: "tc_s_3", toolName: "search", args: { query: "competitor 3" } },
                  { toolCallId: "tc_s_4", toolName: "search", args: { query: "competitor 4" } },
                  { toolCallId: "tc_s_5", toolName: "search", args: { query: "competitor 5" } }
                ]
              },
              {
                toolCalls: [
                  {
                    toolCallId: "tc_add_1",
                    toolName: "addTask",
                    args: { goal: "Analyze acme.example", assignee: "analyzer" }
                  }
                ]
              },
              {
                toolCalls: [
                  {
                    toolCallId: "tc_add_2",
                    toolName: "addTask",
                    args: { goal: "Analyze foo.example", assignee: "analyzer" }
                  }
                ]
              },
              {
                toolCalls: [
                  {
                    toolCallId: "tc_add_3",
                    toolName: "addTask",
                    args: { goal: "Analyze bar.example", assignee: "analyzer" }
                  }
                ]
              },
              {
                toolCalls: [
                  {
                    toolCallId: "tc_add_4",
                    toolName: "addTask",
                    args: { goal: "Analyze baz.example", assignee: "analyzer" }
                  }
                ]
              },
              { text: "Queued four analyzer tasks." }
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
      expect(toolOutputs).toHaveLength(4);
      for (const item of toolOutputs) {
        expect(item.status).not.toBe("in_progress");
      }
    },
    15_000
  );
});
