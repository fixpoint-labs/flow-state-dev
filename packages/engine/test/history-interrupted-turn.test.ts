/**
 * A turn the host died in still belongs to the conversation.
 *
 * When a host is killed mid-turn, the request it was running is left
 * `interrupted`, holding the items it had persisted: the person's message, and the
 * tool calls that already ran (and whose side effects already happened). The
 * session's next request must see what that turn established, or the model
 * answers without that message and re-runs work that was already done. A call still
 * running at the kill never settled, so it has no result to show and is left
 * out.
 */
import type { MessageItem, OutputItem, ToolOutputItem } from "@flow-state-dev/core/items";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createCheckpointDurabilityProvider, createExecutionContext, createInMemoryStores } from "../src";
import type { RuntimeConfig } from "../src/runtime-config";
import type { RequestRecord } from "../src/stores/types";

const SESSION = "sess_killed";
const provenance = { blockName: "gen", blockInstanceId: "gen_1", phase: "main" as const };

function chatFlow() {
  return defineFlow({
    kind: "chat",
    actions: { run: { inputSchema: z.string(), block: handler({ name: "noop", execute: () => "ok" }) } }
  })();
}

function userMessage(requestId: string, text: string, ts: number): MessageItem {
  return { id: `${requestId}_msg`, type: "message", role: "user", content: [{ type: "output_text", text }], status: "completed", requestId, itemIndex: 0, provenance, ts };
}

function toolCall(requestId: string, o: { callId: string; name: string; output: unknown; status: ToolOutputItem["status"]; ts: number; itemIndex: number }): ToolOutputItem {
  return {
    id: `${requestId}_${o.callId}`,
    type: "tool_output",
    status: o.status,
    requestId,
    itemIndex: o.itemIndex,
    provenance,
    ts: o.ts,
    blockName: o.name,
    output: o.output,
    toolCall: { callId: o.callId, name: o.name, alias: o.name, arguments: "{}" }
  } as ToolOutputItem;
}

function turn(id: string, status: RequestRecord["status"], startedAtMs: number, items: OutputItem[], metadata?: Record<string, unknown>): RequestRecord {
  return {
    ...(metadata !== undefined ? { metadata } : {}),
    id,
    flowKind: "chat",
    flowId: "chat",
    orgId: DEFAULT_ORG_ID,
    actionName: "run",
    source: "http",
    userId: "alice",
    sessionId: SESSION,
    status,
    startedAtMs,
    version: 1,
    createdAt: startedAtMs,
    updatedAt: startedAtMs + 1,
    state: {},
    items
  };
}

describe("history across a turn the host died in", () => {
  it("shows the next request what the interrupted turn established, and no call that never settled", async () => {
    const stores = createInMemoryStores();
    await stores.request.set(
      "req_killed",
      turn("req_killed", "interrupted", 1000, [
        userMessage("req_killed", "Draw a ticket, then ask me which region.", 1000) as unknown as OutputItem,
        toolCall("req_killed", { callId: "call_draw", name: "drawTicket", output: { ticket: "TCK-1A2B3C" }, status: "completed", ts: 1001, itemIndex: 1 }) as unknown as OutputItem,
        toolCall("req_killed", { callId: "call_late", name: "lookUpRegion", output: undefined, status: "in_progress", ts: 1002, itemIndex: 2 }) as unknown as OutputItem
      ]),
      "any"
    );

    const ctx = await createExecutionContext({
      orgId: DEFAULT_ORG_ID,
      flow: chatFlow(),
      actionName: "run",
      requestId: "req_after_restart",
      sessionId: SESSION,
      userId: "alice",
      stores
    });

    const history = JSON.stringify(await ctx.session.items.history());
    expect(history).toContain("Draw a ticket, then ask me which region.");
    expect(history).toContain("TCK-1A2B3C");
    // The call the kill cut off has no result: replaying it would hand the
    // model a call with an empty answer.
    expect(history).not.toContain("call_late");
  });

  /** A turn that drew `ticket` for the same message, as `/retry` re-runs it under a new id. */
  const drew = (id: string, status: RequestRecord["status"], startedAtMs: number, ticket: string, metadata?: Record<string, unknown>) =>
    turn(id, status, startedAtMs, [
      userMessage(id, "Draw a ticket.", startedAtMs) as unknown as OutputItem,
      toolCall(id, { callId: `call_${id}`, name: "drawTicket", output: { ticket }, status: "completed", ts: startedAtMs + 1, itemIndex: 1 }) as unknown as OutputItem
    ], metadata);

  const historyOf = async (stores: ReturnType<typeof createInMemoryStores>, extra: { metadata?: Record<string, unknown>; effectiveRuntimeConfig?: RuntimeConfig } = {}) => {
    const ctx = await createExecutionContext({
      orgId: DEFAULT_ORG_ID,
      flow: chatFlow(),
      actionName: "run",
      requestId: "req_now",
      sessionId: SESSION,
      userId: "alice",
      stores,
      ...extra
    });
    return JSON.stringify(await ctx.session.items.history());
  };
  const count = (text: string, part: string) => text.split(part).length - 1;

  // `/retry` runs the turn again under a new id and leaves the original
  // `interrupted`. The retry is the turn; the original is not shown beside it.
  it("leaves out an interrupted turn a retry in the window re-ran", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("req_a", drew("req_a", "interrupted", 1000, "TCK-AAA"), "any");
    await stores.request.set("req_b", drew("req_b", "completed", 2000, "TCK-BBB", { retryOf: "req_a" }), "any");

    const history = await historyOf(stores);
    expect(history).toContain("TCK-BBB");
    expect(history).not.toContain("TCK-AAA");
    expect(count(history, "Draw a ticket.")).toBe(1);
  });

  it("leaves out the interrupted turn the running request is the retry of", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("req_a", drew("req_a", "interrupted", 1000, "TCK-AAA"), "any");

    const history = await historyOf(stores, { metadata: { retryOf: "req_a" } });
    expect(history).not.toContain("TCK-AAA");
    expect(history).not.toContain("Draw a ticket.");
  });

  /** `drew`, parked: its log names the gate it stopped at. */
  const parkedOn = (id: string, startedAtMs: number, ticket: string, gateId: string) => {
    const record = drew(id, "interrupted", startedAtMs, ticket);
    return { ...record, items: [...(record.items ?? []), { type: "suspension", suspensionId: gateId } as never] };
  };
  const gate = (requestId: string, status: "pending" | "approved") => ({
    suspensionId: `susp_${requestId}`,
    requestId,
    flowKind: "chat",
    actionName: "run",
    sessionId: SESSION,
    userId: "alice",
    reason: "user_approval" as const,
    message: "Approve?",
    status,
    blockInstanceId: "gen_1",
    stepIndex: 0,
    createdAt: 1001,
    ...(status === "pending" ? {} : { resolvedAt: 1002, resolvedBy: "alice" })
  });
  const withProvider = (stores: ReturnType<typeof createInMemoryStores>, provider = createCheckpointDurabilityProvider(stores)) => ({
    effectiveRuntimeConfig: { durabilityProvider: provider } as unknown as RuntimeConfig
  });

  // An interrupted request that will run again under the same id is parked,
  // not dead: its gate is pending (a resume drives it), or resolved and owed
  // the sweep's re-drive. Like a `suspended` one, it is left out until it
  // finishes, so a restart does not change what other turns see.
  it("leaves out an interrupted turn that still holds a pending gate", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("req_parked", parkedOn("req_parked", 1000, "TCK-PARKED", "susp_req_parked"), "any");
    await stores.request.set("req_dead", drew("req_dead", "interrupted", 2000, "TCK-DEAD"), "any");
    await stores.suspensions.set(gate("req_parked", "pending"));

    const history = await historyOf(stores, withProvider(stores));
    expect(history).not.toContain("TCK-PARKED");
    expect(history).toContain("TCK-DEAD");
  });

  it("leaves out an interrupted turn whose pending gate is stored but not yet on its log", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("req_parked", drew("req_parked", "interrupted", 1000, "TCK-PARKED"), "any");
    await stores.suspensions.set(gate("req_parked", "pending"));

    const history = await historyOf(stores, withProvider(stores));
    expect(history).not.toContain("TCK-PARKED");
  });

  it("leaves out an interrupted turn whose gate is resolved and still owes a re-drive", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("req_owed", parkedOn("req_owed", 1000, "TCK-OWED", "susp_req_owed"), "any");
    await stores.suspensions.set(gate("req_owed", "approved"));

    const history = await historyOf(stores, withProvider(stores));
    expect(history).not.toContain("TCK-OWED");
  });

  // A gate read that fails costs one turn's view, never the turn: nothing is
  // treated as parked.
  it("still builds the turn when the gates cannot be read", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("req_parked", parkedOn("req_parked", 1000, "TCK-PARKED", "susp_req_parked"), "any");
    const broken = {
      ...createCheckpointDurabilityProvider(stores),
      loadSuspension: async () => {
        throw new Error("the gate store is down");
      }
    };

    const history = await historyOf(stores, withProvider(stores, broken));
    expect(history).toContain("TCK-PARKED");
  });
});
