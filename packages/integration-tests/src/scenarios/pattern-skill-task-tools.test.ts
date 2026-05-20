/**
 * Pattern-skill `taskTools` dispatch regression.
 *
 * In production, the `competitor-analysis` pattern skill's discoverer
 * worker emits 4 `addTask` tool calls (one per analyzer) and a 5th for
 * the synthesizer. Every tool_output envelope is created but no tool ever
 * reaches `item.done` — the handler is never invoked, no block_trace
 * fires for `addTask`, and the discoverer hangs waiting for tool results
 * that never arrive. See `req_1779226169173_3b58daae28b09.events.json`
 * for the captured forensics.
 *
 * The hypothesis: capability-provided tool dispatch (`uses:
 * [taskToolsCapability]`) breaks somewhere between the
 * `emitToolOutputAround` envelope emit and the `callTool` status emit —
 * the gap where `withScope` / `ctx._withExecutionScope` runs.
 *
 * This test isolates that path with the smallest possible repro: one
 * generator, one mocked `addTask` call, no concurrency, no task-board.
 * If the dispatch path is broken the test hangs (which the per-test
 * timeout converts to a fast failure rather than a wedged vitest run).
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import patternSkillTaskToolsFlow from "./fixtures/pattern-skill-task-tools-flow";
import { itemsByType } from "../helpers/assertions";

describe("pattern-skill taskTools dispatch", () => {
  it(
    "completes the tool_output lifecycle for an addTask call from a uses-capability generator",
    async () => {
      const result = await testFlow({
        flow: patternSkillTaskToolsFlow,
        action: "run",
        userId: "test-user",
        input: { message: "Discover competitors for example.com" },
        generators: {
          "capped-discoverer": mockGenerator({
            name: "capped-discoverer",
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

      // Primary regression signal: the run terminated. A dispatch hang
      // would block forever; the vitest per-test timeout would surface
      // it as a "Test timed out" failure.
      expect(result.error).toBeUndefined();
      expect(result.status).toBe("completed");

      // The tool_output lifecycle must close. In production we see
      // `item.added` only — no `item.updated`, no `item.done`. Anything
      // less than a terminal status here reproduces the bug.
      const toolOutputs = itemsByType(result.items, "tool_output").filter(
        (item) => item.toolCall?.name === "addTask"
      );
      expect(toolOutputs).toHaveLength(1);
      expect(toolOutputs[0]!.status).not.toBe("in_progress");
      // The addTask handler returns `{ ok: false, error: "no_active_pattern" }`
      // when no pattern is active — that's fine for this test. We're
      // verifying the dispatch path completes, not the addTask body.
    },
    10_000
  );
});
