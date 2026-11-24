// FIX-2848 D1.
/**
 * The lines workforce writes for an app to draw: a message a worker sent
 * (`workforce:sent`), a task its conversation filed (`workforce:task`) and that
 * task's ending (`workforce:result`), each a client-only `data` item beside the
 * `workforce:received` one.
 *
 * Why it matters: an app draws these from the item, by its `dataType`, and
 * never decodes a `sendMessage` or `createTask` call or the board's ending
 * line itself. A line written inside a tool call is keyed by that call, which
 * is how React's conversation model reads the call as the line and not as a
 * step, and how a waited send's answer replaces its waiting line. Real engine,
 * scripted model.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, type MockGeneratorScriptEntry } from "@flow-state-dev/testing";
import { parseBlockInstanceId } from "@flow-state-dev/contracts/block-instance-id";
import { resolveItemVisibility } from "@flow-state-dev/contracts/items";
import { conversationLines } from "@flow-state-dev/react";
import type { WorkerManifest } from "../src";
import { FILED_TASK_DATA_TYPE, SENT_MESSAGE_DATA_TYPE, TASK_RESULT_DATA_TYPE } from "../src/messages/keys";
import { boardWorkers, bootBoardHost, type BoardHost } from "./conversation-board-harness";

const textOf = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");
const fallback: MockGeneratorScriptEntry = { when: () => true, then: { text: "" } };

function workers(): WorkerManifest[] {
  return [...boardWorkers(), { id: "helper-a", declared: { description: "Passes things on." }, body: "You help.", skills: [] }];
}

/** helper-a calls `sendMessage` once with `args` when its line says `cue`. */
function sends(cue: string, args: Record<string, unknown>, callId = "call-1"): MockGeneratorScriptEntry[] {
  let done = false;
  return [
    {
      when: (input: unknown) => {
        if (done || !textOf(input).includes(cue)) return false;
        done = true;
        return true;
      },
      then: { toolCalls: [{ toolCallId: callId, toolName: "sendMessage", args }] }
    },
    fallback
  ];
}

/** Every item a session's requests stored, oldest request first. */
async function itemsOf(h: BoardHost, sessionId: string): Promise<any[]> {
  return (await h.requestsOf(sessionId)).flatMap((request) => (request as unknown as { items?: any[] }).items ?? []);
}

/** The data items of `dataType` among them. */
const linesOf = (items: readonly any[], dataType: string) => items.filter((item) => item.type === "data" && item.dataType === dataType);

/** The tool call the item's key names: its tool and call id, from the key's last path segment. */
function callOfKey(key: unknown): string | undefined {
  if (typeof key !== "string") return undefined;
  return parseBlockInstanceId(`${key}:0`)?.path.split("/").at(-1);
}

async function helperSession(h: BoardHost): Promise<string> {
  const created = await h.create("alice", "agent", { state: { workerId: "helper-a" } });
  if (created.status !== 201) throw new Error(JSON.stringify(created.body));
  return created.body.session!.id;
}

describe("workforce:sent", () => {
  it("sent · a send writes one line with who, what and the message's id, keyed by its call and kept out of model history", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: sends("Tell otto", { to: "otto", text: "Hello otto." }, "tc_A") }) });
    try {
      await h.client("alice").ensureWorkerSession({ worker: "otto" });
      const helper = await helperSession(h);
      await h.post("alice", helper, "respond", { message: "Tell otto hello" }, "agent");
      await h.settled();
      const items = await itemsOf(h, helper);
      const [line, ...more] = linesOf(items, SENT_MESSAGE_DATA_TYPE);
      expect(more).toEqual([]);
      expect(line.value).toMatchObject({ to: "otto", text: "Hello otto." });
      expect(line.value.messageId).toMatch(/^msg_/);
      expect(line.itemVisibility).toEqual({ client: true, history: false });
      // Keyed by the call that wrote it: the call's own tool and id.
      expect(callOfKey(line.key)).toMatch(/^tool\[sendMessage\]\[(\d+%3A)?tc_A\]$/);
      const call = items.find((item) => item.type === "tool_output" && item.toolCall?.callId === "tc_A");
      expect(call?.requestId).toBe(line.requestId);
      // React's model, on the items the engine stored, reads that call as this line and not as a step.
      const drawn = conversationLines(items, []);
      expect(drawn.filter((l) => l.kind === "steps").flatMap((l) => (l.kind === "steps" ? l.items : [])).map((i) => i.id)).not.toContain(call.id);
      expect(drawn.some((l) => l.kind === "data" && l.item.id === line.id)).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  it("refused · a send refused is still a line, saying why, with no message id", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: sends("Tell nobody", { to: "nobody", text: "Anyone?" }) }) });
    try {
      const helper = await helperSession(h);
      await h.post("alice", helper, "respond", { message: "Tell nobody hello" }, "agent");
      await h.settled();
      const [line, ...more] = linesOf(await itemsOf(h, helper), SENT_MESSAGE_DATA_TYPE);
      expect(more).toEqual([]);
      expect(line?.value).toMatchObject({ to: "nobody", text: "Anyone?" });
      expect(line.value.refused).toMatch(/^no_worker:/);
      expect(line.value).not.toHaveProperty("messageId");
    } finally {
      await h.dispose();
    }
  });
});

/** ana files one task for eng.tasker, by a `createTask` call, when her line says `cue`. */
function files(cue: string, goal: string): MockGeneratorScriptEntry[] {
  let done = false;
  return [
    {
      when: (input: unknown) => {
        if (done || !textOf(input).includes(cue)) return false;
        done = true;
        return true;
      },
      then: { toolCalls: [{ toolCallId: "tc_file", toolName: "createTask", args: { goal, assignee: "eng.tasker" } }] }
    },
    fallback
  ];
}

describe("workforce:task and workforce:result", () => {
  it("task, result · a filing writes a task line keyed by its call, and the task's ending a result line under the worker that ran it", async () => {
    const h = bootBoardHost({
      standard: [...boardWorkers(), { id: "ana", declared: { delegates: ["eng.tasker"] }, body: "You hand work to eng.tasker.", skills: [] }],
      agentAnswer: mockGenerator({ script: files("Find the fact", "Look up the fact") })
    });
    try {
      const created = await h.create("alice", "agent", { state: { workerId: "ana" } });
      const session = created.body.session!.id;
      await h.post("alice", session, "respond", { message: "Find the fact" }, "agent");
      await h.settled(20_000);
      const items = await itemsOf(h, session);
      const [filed] = await h.rows("alice");
      const [task, ...moreTasks] = linesOf(items, FILED_TASK_DATA_TYPE);
      expect(moreTasks).toEqual([]);
      expect(task?.value).toEqual({ taskId: filed!.id, title: "Look up the fact", assignee: "eng.tasker" });
      expect(task.itemVisibility).toEqual({ client: true, history: false });
      expect(callOfKey(task.key)).toMatch(/^tool\[createTask\]\[(\d+%3A)?tc_file\]$/);
      const [result, ...moreResults] = linesOf(items, TASK_RESULT_DATA_TYPE);
      expect(moreResults).toEqual([]);
      expect(result?.value).toMatchObject({ taskId: filed!.id, from: "eng.tasker", title: "Look up the fact", ending: "completed" });
      expect(result.value.text).toContain("Look up the fact");
      expect(result.itemVisibility).toEqual({ client: true, history: false });
    } finally {
      await h.dispose();
    }
  }, 30_000);

  it("result · the ending draws once: the board's ending message stays in the model's history but never reaches a client, where the result line says it", async () => {
    const h = bootBoardHost({
      standard: [...boardWorkers(), { id: "ana", declared: { delegates: ["eng.tasker"] }, body: "You hand work to eng.tasker.", skills: [] }],
      agentAnswer: mockGenerator({ script: files("Find the fact", "Look up the fact") })
    });
    try {
      const created = await h.create("alice", "agent", { state: { workerId: "ana" } });
      const session = created.body.session!.id;
      await h.post("alice", session, "respond", { message: "Find the fact" }, "agent");
      await h.settled(20_000);
      const items = await itemsOf(h, session);
      const [result] = linesOf(items, TASK_RESULT_DATA_TYPE);
      // The board's message that says the same ending: the model still reads it.
      const said = items.find((item) => item.type === "message" && wordsOf(item) === result.value.text);
      expect(said, "the board's ending message").toBeDefined();
      expect(resolveItemVisibility(said)).toEqual({ client: false, history: true });
      // What a client holds, drawn with every renderer an app spreads: one line says the ending.
      const client = items.filter((item) => resolveItemVisibility(item).client);
      const drawn = conversationLines(client, [], { renderers: { message: () => null, data: { [TASK_RESULT_DATA_TYPE]: () => null } } });
      const saysEnding = drawn.filter((l) => (l.kind === "data" && l.item.dataType === TASK_RESULT_DATA_TYPE) || ((l.kind === "assistant" || l.kind === "user") && JSON.stringify(l.item.content).includes(filedTitle)));
      expect(saysEnding.map((l) => l.kind)).toEqual(["data"]);
    } finally {
      await h.dispose();
    }
  }, 30_000);
});

/** A message item's words. */
const wordsOf = (item: any): string => (item.content ?? []).map((part: { text?: string }) => part.text ?? "").join("");

/** The title the filed task is given, which the board's ending message quotes. */
const filedTitle = "Look up the fact";
