/**
 * A turn the host died in still belongs to the conversation.
 *
 * When a host is killed mid-turn, the request it was running is left
 * `interrupted`, holding the items it had persisted: the person's ask, and the
 * tool calls that already ran (and whose side effects already happened). The
 * session's next request must see what that turn established, or the model
 * answers without the ask and re-runs work that was already done. A call still
 * running at the kill never settled, so it has no result to show and is left
 * out.
 */
import type { MessageItem, OutputItem, ToolOutputItem } from "@flow-state-dev/core/items";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExecutionContext, createInMemoryStores } from "../src";
import type { RequestRecord } from "../src/stores/types";

const SESSION = "sess_killed";
const provenance = { blockName: "gen", blockInstanceId: "gen_1", phase: "main" as const };

function chatFlow() {
  return defineFlow({
    kind: "chat",
    actions: { run: { inputSchema: z.string(), block: handler({ name: "noop", execute: () => "ok" }) } }
  })();
}

function ask(requestId: string, text: string, ts: number): MessageItem {
  return { id: `${requestId}_ask`, type: "message", role: "user", content: [{ type: "output_text", text }], status: "completed", requestId, itemIndex: 0, provenance, ts };
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

function turn(id: string, status: RequestRecord["status"], startedAtMs: number, items: OutputItem[]): RequestRecord {
  return {
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
        ask("req_killed", "Draw a ticket, then ask me which region.", 1000) as unknown as OutputItem,
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
});
