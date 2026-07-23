/**
 * FIX-920 §7 — required CI integration test (deterministic, mocked model).
 *
 * Unit tests (`worker-materializer.test.ts`, `skill-md.test.ts`) prove the
 * wiring pieces in isolation: that `materializeWorker` attaches a bounded
 * history slot for `context-supply: conversation`, and that the frontmatter
 * parser round-trips the field. Neither exercises the load-bearing invariant,
 * which spans the whole board-commanded delegation path: host generator
 * `addTask` -> `runBoard` drain -> materialized board worker -> session-
 * history replay -> the worker's assembled prompt -> the worker's items
 * filtered back out of host history. This test drives that path end to end
 * with `mockGenerator`, so CI fails if the delegation wiring stops supplying
 * history — not only when someone remembers to run the by-hand `fsdev run`
 * goal check (see `goals/` — real-model proof that a `conversation` agent's
 * *answer quality* reflects the inherited fact, which a mocked test cannot
 * prove).
 *
 * Three `testFlow` turns share one session (`stores` + `sessionId`, the same
 * pattern as `session-resume.test.ts`):
 *   1. A plain turn that states a fact ("the project codename is Aurora")
 *      the delegated agent's task input never repeats.
 *   2. The host plans one task assigned to the `historian` agent (declared
 *      `context-supply: conversation` in the fixture skill) and drains the
 *      board. The historian's own mock also makes an unrelated tool call
 *      carrying a marker that never appears in its final string — that call
 *      is deliberately NOT captured in the board's result, so if it leaks
 *      into a later turn's assembled history, the leak can only be the
 *      historian's own history:false item resurfacing, not the (expected)
 *      restatement of its returned answer inside the host's own tool_output.
 *   3. A third turn on the same session proves output isolation: the host's
 *      own next-step history assembly must carry the fact forward (its own
 *      history mechanism still works) but must NOT carry the historian's
 *      scratch-note marker (its `itemVisibility.history: false` items stay
 *      out of host history).
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import conversationDelegationFlow from "./fixtures/conversation-delegation-flow";

const FACT = "The project codename is Aurora.";
const SCRATCH_MARKER = "SCRATCHPAD_MARKER_7f3a";
const WORKER_BLOCK_NAME = "skillWorker_research-team_historian";

describe("FIX-920 §7: context-supply conversation — inheritance in, isolation out", () => {
  it(
    "the delegated agent inherits prior conversation, and its own items never re-enter host history",
    async () => {
      const stores = createInMemoryStores();
      const sessionId = "fix920-delegation-history";

      // Turn 1 — establish the fact in a plain (non-delegating) turn.
      const turn1 = await testFlow({
        flow: conversationDelegationFlow,
        action: "run",
        userId: "test-user",
        sessionId,
        stores,
        input: { message: FACT },
        generators: {
          host: mockGenerator({ name: "host", script: [{ text: "Noted." }] })
        },
        unmockedGeneratorPolicy: "error"
      });
      expect(turn1.error).toBeUndefined();
      expect(turn1.status).toBe("completed");

      // Turn 2 — delegate to the historian, then drain the board. The task
      // goal deliberately omits the fact; the historian can only answer it
      // by inheriting turn 1's conversation history.
      const historianMock = mockGenerator({
        name: WORKER_BLOCK_NAME,
        script: [
          {
            toolCalls: [
              {
                toolCallId: "wtc_scratch",
                toolName: "scratch",
                args: { note: SCRATCH_MARKER }
              }
            ]
          },
          { text: "The codename is Aurora." }
        ]
      });

      const turn2 = await testFlow({
        flow: conversationDelegationFlow,
        action: "run",
        userId: "test-user",
        sessionId,
        stores,
        input: { message: "Ask the historian for the project codename, then run the board." },
        generators: {
          host: mockGenerator({
            name: "host",
            script: [
              {
                toolCalls: [
                  {
                    toolCallId: "tc_add",
                    toolName: "addTask",
                    args: {
                      goal: "What is the project codename?",
                      assignee: "historian"
                    }
                  }
                ]
              },
              {
                toolCalls: [{ toolCallId: "tc_run", toolName: "runBoard", args: {} }]
              },
              { text: "The historian says the codename is Aurora." }
            ]
          }),
          [WORKER_BLOCK_NAME]: historianMock
        },
        unmockedGeneratorPolicy: "error"
      });
      expect(turn2.error).toBeUndefined();
      expect(turn2.status).toBe("completed");

      // (a) Inheritance in — the historian's own assembled prompt carries
      // turn 1's fact, not just the task goal.
      expect(historianMock.calls).toHaveLength(1);
      const historianPrompt = JSON.stringify(historianMock.calls[0]!.input);
      expect(historianPrompt).toContain("Aurora");

      // Turn 3 — a fresh host call on the same session. Its own history
      // mechanism (`history: true`) must still carry the fact forward...
      const turn3HostMock = mockGenerator({
        name: "host",
        script: [{ text: "Summary provided." }]
      });
      const turn3 = await testFlow({
        flow: conversationDelegationFlow,
        action: "run",
        userId: "test-user",
        sessionId,
        stores,
        input: { message: "What did we conclude?" },
        generators: { host: turn3HostMock },
        unmockedGeneratorPolicy: "error"
      });
      expect(turn3.error).toBeUndefined();
      expect(turn3.status).toBe("completed");

      expect(turn3HostMock.calls).toHaveLength(1);
      const turn3Prompt = JSON.stringify(turn3HostMock.calls[0]!.input);
      expect(turn3Prompt).toContain("Aurora");

      // (b) Output isolation — the historian's own scratch-note tool call
      // (never part of its returned string, so it can't reach this point via
      // the host's own runBoard tool_output) must not resurface here. If it
      // does, the historian's `itemVisibility.history: false` items leaked
      // into the host's next-step assembled history.
      expect(turn3Prompt).not.toContain(SCRATCH_MARKER);
    },
    20_000
  );
});
