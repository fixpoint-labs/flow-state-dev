/**
 * One routed task at a time in a session two conversations route to
 * (FIX-2083 rule 5 across boards): a board takes the session's record before
 * it claims a routed task for that session, in one compare-and-swap write.
 * Two boards taking one session at once can't both have it. No model: a
 * probe flow files a routed row on its own conversation's board and takes the
 * session for it, in two requests running together.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { conversationLedgerAt, conversationLedgerResources } from "../src/conversation-board/ledger";
import { holdRoutedSession, noteRoutedSession, routedSessionResources } from "../src/conversation-board/routed-session";
import { bootHost, messageOf } from "./coordinator-harness";

const WORKSTREAM_SESSION = "dsx_the-workstream";

/** Both requests file their row, then both take the session together. */
let filed = 0;
let bothFiled!: () => void;
let rowsFiled = new Promise<void>((resolve) => (bothFiled = resolve));

const probeInput = z.object({ partition: z.string(), taskId: z.string(), op: z.enum(["file", "file-together", "hold", "end", "file-and-note"]) });

const probe = handler({
  name: "routed-session-probe",
  inputSchema: probeInput,
  outputSchema: z.object({ holds: z.string().nullable() }),
  resources: { ...conversationLedgerResources, ...routedSessionResources },
  execute: async (input, ctx) => {
    const board = (await conversationLedgerAt(ctx, input.partition))!;
    if (input.op === "end") {
      await board.cancel(input.taskId);
      return { holds: null };
    }
    if (input.op === "file-and-note") {
      // The `work` entry's note, for a task some host claimed without taking the record.
      await board.createTask({ id: input.taskId, goal: "a routed task for the workstream", assignee: "eng.em", targetSessionId: WORKSTREAM_SESSION });
      await noteRoutedSession(ctx, WORKSTREAM_SESSION, { partition: input.partition, taskId: input.taskId });
      const records = (ctx.resources as Record<string, { getOptional(key: string): Promise<{ state: { taskId: string } } | undefined> }>).workforceRoutedSessions!;
      return { holds: (await records.getOptional(encodeURIComponent(WORKSTREAM_SESSION)))?.state.taskId ?? null };
    }
    if (input.op === "file" || input.op === "file-together") {
      await board.createTask({ id: input.taskId, goal: "a routed task for the workstream", assignee: "eng.em", targetSessionId: WORKSTREAM_SESSION });
    }
    if (input.op === "file-together") {
      filed += 1;
      if (filed === 2) bothFiled();
      await rowsFiled;
    }
    return { holds: (await holdRoutedSession(ctx, board, WORKSTREAM_SESSION, input.taskId)) ?? null };
  }
});

const probeFlow = defineFlow({
  kind: "probe",
  resources: { ...conversationLedgerResources, ...routedSessionResources },
  actions: { probe: { inputSchema: probeInput, block: probe } }
});

describe("a session two conversations route to", () => {
  it("is held by one board's routed task when both take it at once, and by the other's once that task ends", async () => {
    filed = 0;
    rowsFiled = new Promise<void>((resolve) => (bothFiled = resolve));
    const host = bootHost({ flows: { probe: probeFlow() as unknown as FlowInstance } });
    const act = async (session: string, input: z.infer<typeof probeInput>) => {
      const result = await host.act("alice", session, "probe", input, "probe");
      expect(result.error, messageOf(result.error)).toBeUndefined();
      return (result.output as { holds: string | null }).holds;
    };
    // An earlier routed task held the session and has ended: the record names
    // it, so both boards read a record either may take over.
    expect(await act("conv-0", { partition: "conv-0-board", taskId: "routed-0", op: "file" })).toBe("routed-0");
    await act("conv-0", { partition: "conv-0-board", taskId: "routed-0", op: "end" });

    const [first, second] = await Promise.all([
      act("conv-1", { partition: "conv-1-board", taskId: "routed-1", op: "file-together" }),
      act("conv-2", { partition: "conv-2-board", taskId: "routed-2", op: "file-together" })
    ]);
    // Exactly one board may start its task there; the other's waits.
    expect([first, second].filter((held) => held !== null)).toHaveLength(1);
    const [winner, loser] = first !== null ? ["1", "2"] : ["2", "1"];
    expect([first, second]).toEqual(winner === "1" ? ["routed-1", null] : [null, "routed-2"]);

    // Asked again, the loser still waits, and the winner still holds it.
    expect(await act(`conv-${loser}`, { partition: `conv-${loser}-board`, taskId: `routed-${loser}`, op: "hold" })).toBeNull();
    expect(await act(`conv-${winner}`, { partition: `conv-${winner}-board`, taskId: `routed-${winner}`, op: "hold" })).toBe(`routed-${winner}`);

    // The winner's task ends: the loser's board takes the session.
    await act(`conv-${winner}`, { partition: `conv-${winner}-board`, taskId: `routed-${winner}`, op: "end" });
    expect(await act(`conv-${loser}`, { partition: `conv-${loser}-board`, taskId: `routed-${loser}`, op: "hold" })).toBe(`routed-${loser}`);
  });

  it("is taken over by the work entry's note when the task its record names has ended, and never while that task is open", async () => {
    const host = bootHost({ flows: { probe: probeFlow() as unknown as FlowInstance } });
    const act = async (session: string, input: z.infer<typeof probeInput>) => {
      const result = await host.act("alice", session, "probe", input, "probe");
      expect(result.error, messageOf(result.error)).toBeUndefined();
      return (result.output as { holds: string | null }).holds;
    };
    // An earlier routed task held the session and has ended.
    expect(await act("conv-0", { partition: "conv-0-board", taskId: "routed-0", op: "file" })).toBe("routed-0");
    await act("conv-0", { partition: "conv-0-board", taskId: "routed-0", op: "end" });
    // A task let in by a host that didn't take the record: its note takes the record over.
    expect(await act("conv-3", { partition: "conv-3-board", taskId: "routed-3", op: "file-and-note" })).toBe("routed-3");
    // Another's note while that task is open leaves the record naming it, and a claim still waits.
    expect(await act("conv-4", { partition: "conv-4-board", taskId: "routed-4", op: "file-and-note" })).toBe("routed-3");
    expect(await act("conv-4", { partition: "conv-4-board", taskId: "routed-4", op: "hold" })).toBeNull();
  });
});
