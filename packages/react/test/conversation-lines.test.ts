// FIX-2848.
/**
 * `conversationLines`: a session's items and turns as the lines a
 * conversation screen draws.
 *
 * Why it matters: every app that shows a conversation draws it from this one
 * model, so each line kind is decided here, once, and an app never reads
 * items itself to find one. Each rule below is one an app used to keep its
 * own copy of: which turn offers Retry (and only when the engine says it
 * retries it), where a stopped turn's line goes, a reply cut off by its
 * turn's failure, a run of steps that never spans two turns, an approval
 * with its answer, and a tool call that wrote a line of its own not drawn a
 * second time as a step.
 */
import { describe, expect, it } from "vitest";
import type { DataItem, ErrorItem, MessageItem, OutputItem, SuspensionItem, SuspensionResumeItem, ToolOutputItem } from "@flow-state-dev/core/items";
import { conversationLines, type ItemLine, type LineTurn } from "../src";

const base = (id: string, requestId: string) => ({ id, requestId, itemIndex: 0, ts: 0, status: "completed" as const, provenance: { blockName: "gen", blockInstanceId: `${requestId}:root:0`, phase: "main" as const } });

const user = (id: string, requestId: string, text = "hi"): MessageItem => ({ ...base(id, requestId), type: "message", role: "user", content: [{ type: "output_text", text }] }) as MessageItem;
const said = (id: string, requestId: string, overrides: Partial<MessageItem> = {}): MessageItem =>
  ({ ...base(id, requestId), type: "message", role: "assistant", content: [{ type: "output_text", text: "sure" }], ...overrides }) as MessageItem;
/** A tool call's output, as its generator (at `root/step[0]`, else `generatorPath`) records it; `stepNumber` is the model step it was in. */
const call = (id: string, requestId: string, name = "search", callId = `c-${id}`, overrides: Partial<ToolOutputItem> = {}, { stepNumber, generatorPath = "root/step[0]" }: { stepNumber?: number; generatorPath?: string } = {}): ToolOutputItem =>
  ({
    ...base(id, requestId),
    provenance: { blockName: "gen", blockInstanceId: `${requestId}:${generatorPath}:0`, phase: "main" as const },
    type: "tool_output",
    blockName: "gen",
    output: null,
    toolCall: { callId, name, arguments: "{}", generatorBlock: "gen", ...(stepNumber === undefined ? {} : { stepNumber }) },
    ...overrides
  }) as ToolOutputItem;
const thought = (id: string, requestId: string): OutputItem => ({ ...base(id, requestId), type: "reasoning", summary: [{ type: "reasoning_text", text: "hm" }] }) as OutputItem;
const failure = (id: string, requestId: string): ErrorItem => ({ ...base(id, requestId), type: "error", message: "boom" }) as ErrorItem;
const data = (id: string, requestId: string, overrides: Partial<DataItem> = {}): DataItem => ({ ...base(id, requestId), type: "data", dataType: "x", value: {}, ...overrides }) as DataItem;

/** A data item written inside a tool call, keyed by that call's logical id, as workforce writes its lines. */
function lineOfCall(id: string, requestId: string, tool: string, segmentCallId: string): DataItem {
  const path = `root/step[0]/tool[${tool}][${segmentCallId}]`;
  return data(id, requestId, { dataType: "workforce:sent", key: `${requestId}:${path}`, provenance: { blockName: tool, blockInstanceId: `${requestId}:${path}:0`, phase: "main" } });
}

const kinds = (lines: readonly ItemLine[]) => lines.map((line) => (line.kind === "steps" ? `steps:${line.items.map((i) => i.id).join(",")}` : `${line.kind}:${line.id}`));

describe("user and assistant lines", () => {
  it("draws what the user said and what the agent said, the agent's as streaming while it is written", () => {
    const lines = conversationLines([user("u1", "r1"), said("a1", "r1", { status: "in_progress" })], [{ id: "r1", status: "in_progress" }]);
    expect(kinds(lines)).toEqual(["user:u1", "assistant:a1"]);
    expect(lines[1]).toMatchObject({ kind: "assistant", streaming: true });
    // Once its turn is over, a reply left half-written is not still being written.
    expect(conversationLines([said("a1", "r1", { status: "in_progress" })], [{ id: "r1", status: "completed" }])[0]).not.toHaveProperty("streaming");
  });

  it("marks a reply its turn's failure or stop cut off as incomplete, never as streaming", () => {
    const failed = conversationLines([user("u1", "r1"), said("a1", "r1", { status: "in_progress" })], [{ id: "r1", status: "failed" }]);
    expect(failed[1]).toMatchObject({ kind: "assistant", incomplete: true });
    expect(failed[1]).not.toHaveProperty("streaming");
    const stopped = conversationLines([said("a1", "r1", { status: "incomplete" })], [{ id: "r1", status: "aborted" }]);
    expect(stopped[0]).toMatchObject({ kind: "assistant", incomplete: true });
    // A reply that finished before its turn failed is whole.
    expect(conversationLines([said("a1", "r1"), failure("e1", "r1")], [{ id: "r1", status: "failed" }])[0]).not.toHaveProperty("incomplete");
  });

  it("marks no reply streaming while its turn is interrupted: nothing writes it until the turn runs again, and the user didn't stop it", () => {
    const lines = conversationLines([said("a1", "r1", { status: "in_progress" })], [{ id: "r1", status: "interrupted" }]);
    expect(lines).toEqual([expect.objectContaining({ kind: "assistant", id: "a1" })]);
    expect(lines[0]).not.toHaveProperty("streaming");
    expect(lines[0]).not.toHaveProperty("incomplete");
  });

  it("draws no line for a reply that ended saying nothing", () => {
    expect(kinds(conversationLines([user("u1", "r1"), said("a1", "r1", { content: [{ type: "output_text", text: "  " }] } as never)]))).toEqual(["user:u1"]);
  });
});

describe("steps", () => {
  it("are one turn's calls and the thinking between them, one after another, ended by what the agent says", () => {
    const lines = conversationLines([thought("t1", "r1"), call("c1", "r1"), thought("t2", "r1"), call("c2", "r1"), said("a1", "r1"), call("c3", "r1")]);
    expect(kinds(lines)).toEqual(["steps:t1,c1,t2,c2", "assistant:a1", "steps:c3"]);
  });

  it("never span two turns, even with nothing between them", () => {
    expect(kinds(conversationLines([call("c1", "r1"), call("c2", "r2")]))).toEqual(["steps:c1", "steps:c2"]);
  });

  it("say when their turn is over, so a call still running there reads as never finished", () => {
    const [line] = conversationLines([call("c1", "r1", "search", "x", { status: "in_progress" })], [{ id: "r1", status: "failed" }]);
    expect(line).toMatchObject({ kind: "steps", ended: true });
    expect(conversationLines([call("c1", "r1")], [{ id: "r1", status: "in_progress" }])[0]).not.toHaveProperty("ended");
  });
});

describe("a tool call that wrote a line", () => {
  it("is that line and not a step: a data item keyed by the call it was written in stands for it", () => {
    const lines = conversationLines([call("c1", "r1", "search"), call("c2", "r1", "sendMessage", "tc_A"), lineOfCall("d1", "r1", "sendMessage", "tc_A"), call("c3", "r1", "read")]);
    expect(kinds(lines)).toEqual(["steps:c1", "data:d1", "steps:c3"]);
  });

  it("is matched by a provider's call id after the model step's index, as the tool executor writes it", () => {
    const lines = conversationLines([call("c2", "r1", "sendMessage", "tc_A", {}, { stepNumber: 3 }), lineOfCall("d1", "r1", "sendMessage", "3%3Atc_A")]);
    expect(kinds(lines)).toEqual(["data:d1"]);
  });

  it("is told apart from a call in another model step that reused its call id and wrote no line", () => {
    // A provider may reuse a call id across steps; only the step-1 call wrote a line, so the step-0 one is still a step.
    const lines = conversationLines([
      call("c1", "r1", "sendMessage", "tc_A", {}, { stepNumber: 0 }),
      call("c2", "r1", "sendMessage", "tc_A", {}, { stepNumber: 1 }),
      lineOfCall("d1", "r1", "sendMessage", "1%3Atc_A")
    ]);
    expect(kinds(lines)).toEqual(["steps:c1", "data:d1"]);
  });

  it("is told apart from a call with the same id made by another generator in the same turn", () => {
    const lines = conversationLines([call("c1", "r1", "sendMessage", "tc_A", {}, { generatorPath: "root/step[1]" }), lineOfCall("d1", "r1", "sendMessage", "tc_A")]);
    expect(kinds(lines)).toEqual(["steps:c1", "data:d1"]);
  });

  it("stays a step when the data item written in it carries no such key (a task board's change record)", () => {
    const record = data("d1", "r1", { dataType: "task-change", key: "board/t1", provenance: { blockName: "createTask", blockInstanceId: "r1:root/step[0]/tool[createTask][tc_B]:0", phase: "main" } });
    expect(kinds(conversationLines([call("c1", "r1", "createTask", "tc_B"), record]))).toEqual(["steps:c1", "data:d1"]);
  });

  it("stays a step when the line names another call, another tool or another turn", () => {
    const items = [call("c1", "r1", "sendMessage", "tc_A"), lineOfCall("d1", "r1", "sendMessage", "tc_Z"), lineOfCall("d2", "r1", "createTask", "tc_A"), lineOfCall("d3", "r2", "sendMessage", "tc_A")];
    expect(kinds(conversationLines(items))[0]).toBe("steps:c1");
  });
});

describe("a failed turn", () => {
  const retryable: LineTurn[] = [
    { id: "r1", status: "completed", retryable: true },
    { id: "r2", status: "failed", retryable: true }
  ];

  it("is a failed line that offers Retry when it is the newest turn that drew a line and the engine retries it", () => {
    const lines = conversationLines([user("u1", "r1"), said("a1", "r1"), user("u2", "r2"), failure("e2", "r2")], retryable);
    expect(lines.at(-1)).toMatchObject({ kind: "failed", id: "e2", requestId: "r2", retryable: true });
  });

  it("offers no Retry when the engine doesn't retry its turn (a worker's message started it)", () => {
    const lines = conversationLines([user("u2", "r2"), failure("e2", "r2")], [{ id: "r2", status: "failed", retryable: false }]);
    expect(lines.at(-1)).toMatchObject({ kind: "failed", retryable: false });
    // Nor when the turns don't say: unknown is not yes.
    expect(conversationLines([failure("e2", "r2")]).at(-1)).toMatchObject({ kind: "failed", retryable: false });
  });

  it("offers no Retry once a later turn drew a line", () => {
    const lines = conversationLines([user("u2", "r2"), failure("e2", "r2"), user("u3", "r3")], [...retryable, { id: "r3", status: "in_progress", retryable: true }]);
    expect(lines.find((line) => line.kind === "failed")).toMatchObject({ retryable: false });
  });
});

describe("a stopped turn", () => {
  it("is a stopped line after that turn's last line, wherever its items sit", () => {
    const items = [user("u1", "r1"), call("c1", "r1"), user("u2", "r2"), said("a1", "r1", { status: "incomplete" }), said("a2", "r2")];
    const lines = conversationLines(items, [{ id: "r1", status: "aborted" }, { id: "r2", status: "completed" }]);
    expect(kinds(lines)).toEqual(["user:u1", "steps:c1", "user:u2", "assistant:a1", "stopped:stopped:r1", "assistant:a2"]);
  });

  it("goes before a later failed turn and leaves that one's Retry", () => {
    const items = [user("u1", "r1"), user("u2", "r2"), failure("e2", "r2")];
    const lines = conversationLines(items, [{ id: "r1", status: "aborted" }, { id: "r2", status: "failed", retryable: true }]);
    expect(kinds(lines)).toEqual(["user:u1", "stopped:stopped:r1", "user:u2", "failed:e2"]);
    expect(lines.at(-1)).toMatchObject({ retryable: true });
  });

  it("is drawn only for a turn that ended aborted", () => {
    expect(kinds(conversationLines([user("u1", "r1")], [{ id: "r1", status: "failed" }]))).toEqual(["user:u1"]);
    expect(kinds(conversationLines([user("u1", "r1")]))).toEqual(["user:u1"]);
  });
});

describe("a suspension", () => {
  const asked = { ...base("s1", "r1"), type: "suspension", status: "in_progress", suspensionId: "sp1", reason: "user_approval", message: "Deploy?" } as unknown as SuspensionItem;
  const answer = { ...base("sr1", "r1"), type: "suspension_resume", suspensionId: "sp1", resolution: "approved" } as unknown as SuspensionResumeItem;

  it("is a line that carries its answer once it has one; the answer's record draws nothing itself", () => {
    expect(conversationLines([asked])).toEqual([{ kind: "suspension", id: "s1", requestId: "r1", item: asked }]);
    const lines = conversationLines([asked, answer]);
    expect(kinds(lines)).toEqual(["suspension:s1"]);
    expect(lines[0]).toMatchObject({ resolution: "approved" });
  });
});

describe("records that draw nothing", () => {
  // A feed that names its item types gets client-hidden items too: a task's ending
  // message is history-only beside its result line, and must not draw a second time.
  it("are no line: an item the client isn't shown, even with sub-agents shown", () => {
    const ending = said("a1", "r1", { itemVisibility: { client: false, history: true } } as Partial<MessageItem>);
    expect(kinds(conversationLines([user("u1", "r1"), ending]))).toEqual(["user:u1"]);
    expect(kinds(conversationLines([user("u1", "r1"), ending], [], { showSubAgents: true }))).toEqual(["user:u1"]);
  });

  it("are no line: a state change, a resource change, a continuation", () => {
    const records = ["state_change", "resource_change", "continuation"].map((type, n) => ({ ...base(`x${n}`, "r1"), type }) as unknown as OutputItem);
    expect(conversationLines([...records, user("u1", "r1")]).map((line) => line.kind)).toEqual(["user"]);
  });

  // A record (a board's task change) is no line on screen: it must not take Retry off the failed turn before it.
  it("are no line: a data item the registry in use has no renderer for, or one it turns off", () => {
    const record = data("d1", "pass-1", { dataType: "task-change" });
    const shown = data("d2", "r1", { dataType: "workforce:sent" });
    const renderers = { data: { "workforce:sent": () => null, "routing": false as const } };
    const lines = conversationLines([user("u1", "r1"), failure("e1", "r1"), record, data("d3", "pass-2", { dataType: "routing" })], [{ id: "r1", status: "failed", retryable: true }], { renderers });
    expect(kinds(lines)).toEqual(["user:u1", "failed:e1"]);
    expect(lines.at(-1)).toMatchObject({ retryable: true });
    expect(kinds(conversationLines([shown], [], { renderers }))).toEqual(["data:d2"]);
    // With no registry given, every data item is still a line: the model can't know what draws.
    expect(kinds(conversationLines([record]))).toEqual(["data:d1"]);
  });
});
