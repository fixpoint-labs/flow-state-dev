/**
 * `readSettledTurns`: which of a session's open turns a model may read.
 *
 * A turn parked on a call (a wait gate bound to a request it started) gave
 * its session back, so another turn can run there before it resumes, and
 * that turn must read what the waiting one has said so far: the line that
 * started it is often the only place a fact it needs was told. Every other
 * open turn stays out, since what it says is not final: a stop for the user
 * (whose answer resumes the turn reading the session as it left it), a wait
 * on a task, and a request still running.
 *
 * Literal records over a fake request store and durability provider.
 */
import type { MessageItem, OutputItem, ToolOutputItem } from "@flow-state-dev/core/items";
import type { SuspensionRecord } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { expandRequestToMessages, LLM_AUDIENCE_TYPES } from "../../src/context/history";
import { readSettledTurns } from "../../src/context/settled-turns";
import type { RequestRecord } from "../../src/stores/types";

const SCOPE = { sessionId: "s1", tenantId: undefined, userId: "u1", orgId: undefined, flowKind: "agent" };
/** A generator's provenance (`<requestId>:<path>:<attempt>`), so the canonical log can key its tool calls. */
const provenance = { blockName: "agent", blockInstanceId: "filing:agent:0", phase: "main" as const };

function line(requestId: string, text: string, ts: number): MessageItem {
  return { id: `${requestId}-line`, type: "message", status: "completed", requestId, itemIndex: 0, provenance, ts, role: "user", content: [{ type: "output_text", text }] } as MessageItem;
}

/** The tool call a park leaves on the log: failed, coded `SUSPENSION`. */
function parkedCall(requestId: string, ts: number): ToolOutputItem {
  return {
    id: `${requestId}-call`,
    type: "tool_output",
    status: "failed",
    requestId,
    itemIndex: 1,
    provenance,
    ts,
    toolCall: { callId: "c1", name: "sendMessage", arguments: JSON.stringify({ to: "stopper", wait: true }) },
    error: { message: "Waiting on the reply to message m1", code: "SUSPENSION" }
  } as unknown as ToolOutputItem;
}

/** A tool call that finished before the park. */
function finishedCall(requestId: string, ts: number): ToolOutputItem {
  return {
    id: `${requestId}-filed`,
    type: "tool_output",
    status: "completed",
    requestId,
    itemIndex: 2,
    provenance,
    ts,
    toolCall: { callId: "c0", name: "createTask", arguments: JSON.stringify({ goal: "Book the caterer" }) },
    output: { ok: true }
  } as unknown as ToolOutputItem;
}

/**
 * The tool-call ids that lack their other half: a call with no result, or a
 * result with no call. Providers refuse either, so this must come back empty
 * on the messages before any orphan trim runs.
 */
function unpairedToolCalls(messages: readonly { role: string; content: unknown }[]): string[] {
  const ids = (role: string, type: string) =>
    new Set(
      messages
        .filter((m) => m.role === role && Array.isArray(m.content))
        .flatMap((m) => (m.content as Array<{ type?: string; toolCallId?: string }>).filter((p) => p.type === type).map((p) => p.toolCallId!))
    );
  const calls = ids("assistant", "tool-call");
  const results = ids("tool", "tool-result");
  return [...[...calls].filter((id) => !results.has(id)), ...[...results].filter((id) => !calls.has(id))];
}

function record(id: string, status: RequestRecord["status"], startedAtMs: number, items: OutputItem[]): RequestRecord {
  return { id, status, startedAtMs, updatedAt: startedAtMs, items, userId: "u1", sessionId: "s1", flowKind: "agent", actionName: "respond" } as unknown as RequestRecord;
}

function gate(requestId: string, reason: string, data: Record<string, unknown>): SuspensionRecord {
  return { suspensionId: `g-${requestId}`, requestId, reason, data, status: "pending", userId: "u1", sessionId: "s1", flowKind: "agent", actionName: "respond", message: "Waiting" } as unknown as SuspensionRecord;
}

async function read(records: RequestRecord[], gates: SuspensionRecord[]) {
  return readSettledTurns({
    requests: {
      list: async (filter: { status?: readonly string[] | string }) => {
        const statuses = ([] as string[]).concat(filter.status ?? []);
        return records.filter((r) => statuses.includes(r.status)).sort((a, b) => b.startedAtMs - a.startedAtMs);
      }
    } as never,
    scope: SCOPE,
    turns: 20,
    runningRequestId: "now",
    durability: { listSuspended: async () => gates, loadSuspension: async () => null },
    onGateReadError: (error) => {
      throw error;
    }
  });
}

const messages = (records: RequestRecord[]) => records.flatMap((r) => expandRequestToMessages(r.items ?? [], LLM_AUDIENCE_TYPES, undefined));
const text = (records: RequestRecord[]) => JSON.stringify(messages(records));

describe("readSettledTurns, for the session's open turns", () => {
  const earlier = record("done", "completed", 1, [line("done", "Hello.", 1)]);
  const filing = record("filing", "suspended", 2, [line("filing", "The gala is at Harbor Hall.", 2), finishedCall("filing", 2.5), parkedCall("filing", 3)]);

  it("reads a turn waiting on a call as far as it got, and says it still waits", async () => {
    const turns = await read([earlier, filing], [gate("filing", "wait", { requestId: "r-recipient", deadline: 9 })]);
    expect(turns.settled.map((r) => r.id)).toEqual(["done", "filing"]);
    expect(turns.waiting).toEqual(new Set(["filing"]));
    const said = text(turns.settled);
    expect(said).toContain("Harbor Hall");
    // The parked call has not failed: it is named as still waiting, never replayed as a failure.
    expect(said).toContain("still waiting on sendMessage");
    expect(said).not.toContain("failed");
    // Every tool call it is handed has its result, and every result its call,
    // before any orphan trim: the parked call goes out whole, never half.
    expect(said).toContain("createTask");
    expect(unpairedToolCalls(messages(turns.settled))).toEqual([]);
  });

  it("never quotes a parked call the history view hides", async () => {
    const hidden = { ...parkedCall("filing", 3), itemVisibility: { client: true, history: false } } as ToolOutputItem;
    (hidden.toolCall as { arguments: string }).arguments = JSON.stringify({ to: "vault", text: "the hidden secret" });
    const quiet = record("filing", "suspended", 2, [line("filing", "The gala is at Harbor Hall.", 2), hidden]);
    const turns = await read([earlier, quiet], [gate("filing", "wait", { requestId: "r-recipient", deadline: 9 })]);
    const said = text(turns.settled);
    expect(said).toContain("Harbor Hall");
    expect(said).toContain("still waiting on a call");
    expect(said).not.toContain("hidden secret");
    expect(said).not.toContain("sendMessage");
  });

  it("names only the call it waits on now, not one an earlier park resumed", async () => {
    // Run 1 parked on approveSpend; the resume settled it (same callId, completed), then parked on sendMessage.
    const resumedFrom = { ...parkedCall("filing", 2.2), id: "filing-a1", itemIndex: 1, toolCall: { callId: "cA", name: "approveSpend", arguments: "{}" } } as ToolOutputItem;
    const settledA = { ...finishedCall("filing", 2.4), id: "filing-a2", itemIndex: 3, toolCall: { callId: "cA", name: "approveSpend", arguments: "{}" } } as ToolOutputItem;
    const parkedB = { ...parkedCall("filing", 3), itemIndex: 4 } as ToolOutputItem;
    const twice = record("filing", "suspended", 2, [line("filing", "The gala is at Harbor Hall.", 2), resumedFrom, settledA, parkedB]);
    const turns = await read([earlier, twice], [gate("filing", "wait", { requestId: "r-recipient", deadline: 9 })]);
    const said = text(turns.settled);
    expect(said).toContain("still waiting on sendMessage");
    expect(said).not.toMatch(/still waiting on[^)]*approveSpend/);
    expect(unpairedToolCalls(messages(turns.settled))).toEqual([]);
  });

  it("reads an interrupted turn whose call gate is still pending the same way", async () => {
    const died = { ...filing, status: "interrupted" as const };
    const turns = await read([earlier, died], [gate("filing", "wait", { requestId: "r-recipient", deadline: 9 })]);
    expect(turns.waiting).toEqual(new Set(["filing"]));
    expect(text(turns.settled)).toContain("Harbor Hall");
  });

  it("leaves out a turn stopped for its user", async () => {
    const turns = await read([earlier, filing], [gate("filing", "input", {})]);
    expect(turns.settled.map((r) => r.id)).toEqual(["done"]);
    expect(turns.waiting.size).toBe(0);
  });

  it("leaves out a turn that holds a stop for its user beside its call", async () => {
    const turns = await read([earlier, filing], [gate("filing", "wait", { requestId: "r-recipient", deadline: 9 }), { ...gate("filing", "approval", {}), suspensionId: "g-stop" }]);
    expect(turns.settled.map((r) => r.id)).toEqual(["done"]);
  });

  it("leaves out a turn waiting on a task", async () => {
    const turns = await read([earlier, filing], [gate("filing", "wait", { board: "b1", taskId: "t1", deadline: 9 })]);
    expect(turns.settled.map((r) => r.id)).toEqual(["done"]);
  });
});
