/** A coordinator failure that completes its request still reaches the Error Reporter. */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { owedReports } from "../src/conversation-board/report-owed";
import { ERROR_REPORTER_INTAKE_FLOW, INTAKE_ENTRY } from "../src/error-reporter/keys";
import { bootHost, quiet } from "./coordinator-harness";

function recordingIntake(taken: Array<Record<string, unknown>>): FlowInstance {
  const intake = handler({
    name: "recording-intake",
    inputSchema: z.object({ occurrence: z.record(z.string(), z.unknown()) }),
    execute: (input) => {
      taken.push(input.occurrence);
      return { decision: "new" };
    }
  });
  const flow = defineFlow({
    kind: ERROR_REPORTER_INTAKE_FLOW,
    actions: {},
    internal: { actions: { [INTAKE_ENTRY]: { inputSchema: intake.inputSchema, block: intake } } }
  } as never);
  return (flow as unknown as (options: { id: string }) => FlowInstance)({ id: ERROR_REPORTER_INTAKE_FLOW });
}

describe("a coordinator's failures reach the Error Reporter", () => {
  it("sends a delegate's failed post on its ending, not on the board's next touch", async () => {
    const taken: Array<Record<string, unknown>> = [];
    const host = bootHost({ flows: { [ERROR_REPORTER_INTAKE_FLOW]: recordingIntake(taken) } });
    const id = await host.conversation("alice", "desk");
    const turn = await host.act("alice", id, "run", { message: "[route:eng.em] [conf:0.9] [fail:eng.em] plan the release" });
    expect(turn.error).toBeUndefined();
    await host.settled();
    const [row] = await host.postRows("alice");
    expect(row).toMatchObject({ status: "errored", assignee: "eng.em" });
    expect(taken).toEqual([
      expect.objectContaining({ kind: "task", taskId: row.id, assignee: "eng.em", error: "eng.em could not answer", userId: "alice" })
    ]);
  });

  it("doesn't send a post whose run the user cancelled: the row ends cancelled, not errored", async () => {
    // A user who stops a delegate's run meant to: that is not a bug to file.
    const taken: Array<Record<string, unknown>> = [];
    const host = bootHost({ flows: { [ERROR_REPORTER_INTAKE_FLOW]: recordingIntake(taken) }, roundDeadlineMs: 60_000 });
    const id = await host.conversation("alice", "desk");
    const turn = await host.act("alice", id, "run", { message: "[route:eng.coder] [conf:0.9] [hang:eng.coder] status?" });
    expect(turn.error).toBeUndefined();
    expect(await host.cancelDelegate("alice", "eng.coder")).toBe(204);
    await quiet(host);
    const [row] = await host.postRows("alice");
    // Nothing is owed, so no later touch of the board sends it either.
    expect(owedReports(row)).toEqual([]);
    expect(taken).toEqual([]);
    expect(row).toMatchObject({ status: "cancelled", assignee: "eng.coder" });
  });

  it("sends best fit's crashed judgment turn, which the post's answer rescues", async () => {
    const taken: Array<Record<string, unknown>> = [];
    const host = bootHost({ flows: { [ERROR_REPORTER_INTAKE_FLOW]: recordingIntake(taken) } });
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "setFallback", { worker: null })).error).toBeUndefined();
    const turn = (await host.act("alice", id, "run", { message: "no mark, and no judgment script" })) as { error?: unknown; requestId?: string };
    // The request completes on "Nobody took this post", so the engine sends no final event for it.
    expect(turn.error).toBeUndefined();
    const said = (await host.items(id)).messages.at(-1)!.text;
    expect(said).toMatch(/^Nobody took this post: /);
    expect(taken).toEqual([
      expect.objectContaining({
        kind: "request",
        requestId: turn.requestId,
        flowKind: "coordinator",
        actionName: "run",
        blockName: "coordinator-judgment",
        sessionId: id,
        userId: "alice",
        message: expect.any(String)
      })
    ]);
    // The crash it reports is the one the conversation was told about.
    expect(turn.requestId).toBeDefined();
    expect(said).toContain(String(taken[0]!.message));
  });
});
