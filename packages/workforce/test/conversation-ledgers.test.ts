/**
 * Which conversation's board a `work` entry's gate may read (FIX-2083):
 * `conversationLedgers`, the resolver the gate reads the dispatched row
 * through. A session works the board of the conversation it was opened for,
 * and, on another conversation's board, only a row filed for this very
 * session (`Task.targetSessionId`, server-written): a routed task for a
 * workstream. No model: a probe flow calls the resolver in its own session.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { CONVERSATION_LEDGER_ID, conversationLedgerAt, conversationLedgerResources } from "../src/conversation-board/ledger";
import { conversationLedgers } from "../src/conversation-board/task-entry";
import { bootHost, messageOf } from "./coordinator-harness";

const probeInput = z.object({ partition: z.string(), taskId: z.string(), filedForMe: z.boolean() });

/** File a row on another conversation's board, for this session or not, then ask the resolver for that board. */
const probe = handler({
  name: "ledger-probe",
  inputSchema: probeInput,
  outputSchema: z.object({ resolved: z.boolean() }),
  resources: { ...conversationLedgerResources },
  execute: async (input, ctx) => {
    const board = await conversationLedgerAt(ctx, input.partition);
    await board!.createTask({
      id: input.taskId,
      goal: "a row on another conversation's board",
      ...(input.filedForMe ? { targetSessionId: ctx.session.identity.id } : {})
    });
    return { resolved: (await conversationLedgers(CONVERSATION_LEDGER_ID, ctx, input.partition, input.taskId)) !== undefined };
  }
});

const probeFlow = defineFlow({
  kind: "probe",
  resources: { ...conversationLedgerResources },
  actions: { probe: { inputSchema: probeInput, block: probe } }
});

describe("the ledger a work entry's gate reads", () => {
  it("is another conversation's board only for a row filed for this session; any other row there is refused", async () => {
    const host = bootHost({ flows: { probe: probeFlow() as unknown as FlowInstance } });
    const run = async (taskId: string, filedForMe: boolean) => {
      const result = await host.act("alice", "probe-session", "probe", { partition: "someone-elses-conversation", taskId, filedForMe }, "probe");
      expect(result.error, messageOf(result.error)).toBeUndefined();
      return (result.output as { resolved: boolean }).resolved;
    };
    expect(await run("task_not_for_me", false)).toBe(false);
    expect(await run("task_for_me", true)).toBe(true);
  });
});
