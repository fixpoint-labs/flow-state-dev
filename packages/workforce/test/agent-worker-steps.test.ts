/**
 * The built-in `agent` flow plans its turns (FIX-2076 D1, D2): a worker with no
 * delegates is offered the task tools for its own steps, a `createTask`
 * naming itself is a step worked after the turn in the same request, and the
 * worker answers once more, which is the turn's result.
 *
 * The model is scripted by what each call's input says; what is asserted is
 * read back from the store.
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { mockGenerator, type MockGeneratorScriptEntry } from "@flow-state-dev/testing";
import type { WorkerManifest } from "../src/manifest";
import { ORG, boardWorkers, bootBoardHost, messageOf } from "./conversation-board-harness";

const textOf = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");

function script(): MockGeneratorScriptEntry[] {
  let filed = false;
  return [
    { when: (input) => textOf(input).includes("The steps you filed for yourself have ended"), then: { text: "Final post, from the outline." } },
    { when: (input) => textOf(input).includes("You are working a step you filed for yourself"), then: { text: "OUTLINE-ALPHA" } },
    { when: (input) => filed && textOf(input).includes("write the post"), then: { text: "I'll outline it first." } },
    {
      when: (input) => {
        if (filed || !textOf(input).includes("write the post")) return false;
        filed = true;
        return true;
      },
      then: { toolCalls: [{ toolCallId: "call-outline", toolName: "createTask", args: { goal: "Outline the post", assignee: "solo" } }] }
    },
    { when: () => true, then: { text: "OK." } }
  ];
}

const worker = (id: string, declared: Record<string, unknown>, body = ""): WorkerManifest => ({ id, declared, body, skills: [] });

describe("an `agent` worker with no delegates works a step for itself", () => {
  it("files it from its turn, works it in the same request and session, and answers once more", async () => {
    const h = bootBoardHost({
      standard: [...boardWorkers(), worker("solo", {}, "You work alone.")],
      agentAnswer: mockGenerator({ script: script() })
    });
    try {
      const created = await h.create("alice", "agent", { state: { workerId: "solo" } });
      const talk = created.body.session!.id;
      const result = await h.act("alice", talk, "respond", { message: "write the post" }, "agent");
      expect(result.error, messageOf(result.error)).toBeUndefined();
      await h.settled();

      const runtime = await h.state.getRuntime();
      const entries = await runtime.stores.resourceState.getByPrefix("user", `alice:~org:${ORG}`, "plan/");
      const steps = Object.values(entries).map((value) => value.state as Task);
      expect(steps.map((row) => [row.goal, row.status, row.assignee])).toEqual([["Outline the post", "completed", "solo"]]);
      expect(JSON.stringify(steps[0]!.output)).toContain("OUTLINE-ALPHA");
      // Nothing was handed to a delegate, and every turn was this conversation's.
      expect(await h.rows("alice")).toEqual([]);
      expect((await h.requestsOf(talk)).map((request) => request.actionName)).toEqual(["respond"]);
      // The turn's result is the answer that saw the step end.
      expect(JSON.stringify(result.output)).toContain("Final post, from the outline.");
    } finally {
      await h.dispose();
    }
  });
});
