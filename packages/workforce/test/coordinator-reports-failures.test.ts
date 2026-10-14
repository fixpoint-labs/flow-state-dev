/**
 * A coordinator's failures reach the Error Reporter (FIX-1983). Neither path
 * ends in a failed request, so the engine's final event never covers them:
 * a delegate's post that fails ends its row errored inside a request that
 * completes, and best fit's judgment turn that crashes is rescued into
 * "Nobody took this post". Each hands its failure to the intake itself.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ERROR_REPORTER_INTAKE_FLOW, INTAKE_ENTRY } from "../src/error-reporter/keys";
import { bootHost } from "./coordinator-harness";

/** A stand-in for the reporter's intake: it keeps every occurrence it is sent. */
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

  it("sends best fit's crashed judgment turn, which the post's answer rescues", async () => {
    const taken: Array<Record<string, unknown>> = [];
    const host = bootHost({ flows: { [ERROR_REPORTER_INTAKE_FLOW]: recordingIntake(taken) } });
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "setFallback", { worker: null })).error).toBeUndefined();
    const turn = (await host.act("alice", id, "run", { message: "no mark, and no judgment script" })) as { error?: unknown; requestId?: string };
    // The request completes on "Nobody took this post", so the engine sends no final event for it.
    expect(turn.error).toBeUndefined();
    expect((await host.items(id)).messages.at(-1)!.text).toMatch(/^Nobody took this post: /);
    expect(taken).toEqual([
      expect.objectContaining({ kind: "request", flowKind: "coordinator", actionName: "run", blockName: "coordinator-judgment", sessionId: id, userId: "alice" })
    ]);
  });
});
