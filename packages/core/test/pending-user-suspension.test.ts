// FIX-2770.
/**
 * The one projector every suspension store builds a pending row with.
 *
 * Why it matters: a pending ask crosses to an Inbox screen. The run's
 * payload (`stepInput`, `resumeData`, the author's `data`) must never leave
 * the server, and structural typing would not stop a store that spread a
 * record into the row, so the projector reads only the fields it names and
 * the row type has no key for the payload.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { projectUserSuspension, type PendingUserSuspension, type SuspensionRecord } from "../src/types";

describe("projectUserSuspension", () => {
  it("yields only the projection, even handed a whole record with its payload", () => {
    const record: SuspensionRecord & { flowKind: string; sessionId: string } = {
      suspensionId: "s1",
      requestId: "r1",
      flowKind: "worker",
      flowId: "worker",
      actionName: "respond",
      sessionId: "sess_1",
      userId: "alice",
      reason: "user_input",
      message: "?",
      data: { secret: 1 },
      status: "pending",
      blockInstanceId: "b1",
      stepIndex: 3,
      stepInput: { secret: 2 },
      resumeData: { secret: 3 },
      resolvedBy: "x",
      createdAt: 5
    };
    const entry = projectUserSuspension(record);
    expect(entry).toEqual({ suspensionId: "s1", requestId: "r1", flowKind: "worker", flowId: "worker", sessionId: "sess_1", kind: "input", shape: "approval", message: "?", createdAt: 5 });
  });

  it("derives kind from a raw stop's reason, and reads SQL's nulls as absent", () => {
    const entry = projectUserSuspension({
      suspensionId: "s1",
      requestId: "r1",
      flowKind: "worker",
      flowId: null,
      sessionId: null,
      reason: "user_approval",
      kind: null,
      title: null,
      message: "ok?",
      allow: null,
      resumeSchema: null,
      render: null,
      createdAt: 7,
      expiresAt: null
    });
    expect(entry).toEqual({ suspensionId: "s1", requestId: "r1", flowKind: "worker", kind: "approval", shape: "approval", message: "ok?", createdAt: 7 });
  });

  it("has no key for the run's payload or how it resolved", () => {
    type Keys = keyof PendingUserSuspension;
    expectTypeOf<"stepInput" extends Keys ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<"resumeData" extends Keys ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<"data" extends Keys ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<"resolvedBy" extends Keys ? true : false>().toEqualTypeOf<false>();
  });
});
