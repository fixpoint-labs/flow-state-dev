/**
 * What a conversation's task lines say as data (FIX-2378). An app draws a
 * task's ending as a result, and a delegate's answer as that delegate's, by
 * reading the line's message item: orchestration's `parseNotice` for an
 * ending's line, `delegateAnswerOf` for an answer that lands as written. It
 * never matches the line's words or guesses from `agentName`, so a change to
 * either can't break it silently.
 *
 * Each leg reads the items the conversation stored, on the real engine.
 */
import { describe, expect, it } from "vitest";
import { parseNotice } from "@flow-state-dev/orchestration/tasks";
import { delegateAnswerOf } from "../src/browser";
import { boardWorkers, bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";
import { bootHost } from "./coordinator-harness";

/** File one task in a fresh `worker` conversation through the action, let it end, and return its id and the conversation's stored message items. */
async function fileAndSettle(worker: string, input: Record<string, unknown>, flow = "coordinator") {
  const host = bootBoardHost({
    // An `agent` worker, not a coordinator, whose delegate takes tasks.
    standard: [...boardWorkers(), { id: "ana", declared: { delegates: ["eng.tasker"] }, body: "You file the work.", skills: [] }]
  });
  try {
    const conv = flow === "coordinator" ? await host.conversation("alice", worker) : await agentSession(host, worker);
    const filed = await host.act("alice", conv, "createTask_tasks", { assignee: "eng.tasker", ...input }, flow);
    expect(filed.error, messageOf(filed.error)).toBeUndefined();
    const taskId = (filed.output as { taskId: string }).taskId;
    await host.settled();
    const items = (await host.requestsOf(conv))
      .flatMap((request) => (request as unknown as { items?: any[] }).items ?? [])
      .filter((item) => item.type === "message");
    return { taskId, items };
  } finally {
    await host.dispose();
  }
}

/** An `agent` conversation with `worker`. */
async function agentSession(host: BoardHost, worker: string): Promise<string> {
  const created = await host.create("alice", "agent", { state: { workerId: worker } });
  if (created.status !== 201 && created.status !== 200) throw new Error(`creating ${worker}'s session failed (${created.status})`);
  return created.body.session!.id;
}

describe("a task's ending lands as a line that names its task and ending as data", () => {
  it.each([
    ["a completion", "Count licenses", "completed"],
    ["a final failure", "Count licenses [fail]", "errored"]
  ] as const)("%s: the line's item says which task and how it ended", async (_label, goal, ending) => {
    const { taskId, items } = await fileAndSettle("rota", { goal, maxAttempts: 1 });
    const lines = items.map((item) => parseNotice(item)).filter((line) => line !== undefined);
    expect(lines).toEqual([expect.objectContaining({ taskId, ending, title: goal, attempt: 1 })]);
    // Read off the data its item carries, not its words.
    const line = items.find((item) => parseNotice(item) !== undefined)!;
    expect(line.metadata?.taskNotice).toMatchObject({ taskId, ending });
    // An ending's line is no delegate's answer.
    expect(delegateAnswerOf(line)).toBeUndefined();
  });
});

describe("a delegate's answer that lands as written is marked as that delegate's", () => {
  it("a task filed with its result to the conversation: its answer names the worker and the task", async () => {
    const { taskId, items } = await fileAndSettle("rota", { goal: "Tell everyone", resultTo: "conversation" });
    const answers = items.filter((item) => delegateAnswerOf(item) !== undefined);
    expect(answers).toHaveLength(1);
    expect(delegateAnswerOf(answers[0])).toEqual({ worker: "eng.tasker", taskId });
    expect(answers[0].content[0].text).toBe("eng.tasker did: Tell everyone");
    // It is the answer itself, not an ending's line.
    expect(parseNotice(answers[0])).toBeUndefined();
  });

  it("the same, filed from a worker's own conversation, which no coordinator routes", async () => {
    const { taskId, items } = await fileAndSettle("ana", { goal: "Tell everyone", resultTo: "conversation" }, "agent");
    const answers = items.filter((item) => delegateAnswerOf(item) !== undefined);
    expect(answers.map((item) => delegateAnswerOf(item))).toEqual([{ worker: "eng.tasker", taskId }]);
  });

  it("a message a policy routes: the delegate's answer names the worker and the routed task", async () => {
    const host = bootHost();
    try {
      const id = await host.conversation("alice", "desk");
      const posted = await host.act("alice", id, "respond", { message: "first [route:eng.coder]" });
      expect(posted.error, messageOf(posted.error)).toBeUndefined();
      await host.settled();
      const listed = await host.act("alice", id, "listTasks_tasks", {});
      const [task] = (listed.output as { tasks: Array<{ id: string }> }).tasks;
      const answers = (await host.items(id)).all.filter((item: any) => delegateAnswerOf(item) !== undefined);
      expect(answers.map((item: any) => delegateAnswerOf(item))).toEqual([{ worker: "eng.coder", taskId: task!.id }]);
    } finally {
      await host.dispose?.();
    }
  });

  it("the conversation's own words carry no marker", async () => {
    const { items } = await fileAndSettle("rota", { goal: "Count licenses" });
    const unmarked = items.filter((item) => delegateAnswerOf(item) === undefined && parseNotice(item) === undefined);
    for (const item of unmarked) expect(item.metadata).toBeUndefined();
  });
});
