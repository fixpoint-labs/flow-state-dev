/**
 * `ctx.waitForUser` (FIX-2129): what each kind asks the runtime for, and how
 * each way a stop ends comes back to the block. The suspension is a stub here:
 * what it is resumed with is the engine's (see `engine/test/wait-for-user.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { SuspensionRejectedError, SuspensionTimeoutError, type SuspendOptions } from "../src/errors/suspension-error";
import { waitForUserOn } from "../src/types/wait-for-user";
import { isUserSuspension, waitForUserKindOf } from "../src/types/suspension";

/** A context whose `suspend` answers with `answer`, or throws it, and records what it was asked. */
function ctxThat(answer: { returns: unknown } | { throws: Error }, host?: { userDeadlineMs?: number }) {
  const asked: SuspendOptions[] = [];
  return {
    asked,
    ctx: {
      ...(host !== undefined ? { requestHost: host } : {}),
      suspend: async (options: SuspendOptions) => {
        asked.push(options);
        if ("throws" in answer) throw answer.throws;
        return answer.returns;
      },
    },
  };
}

describe("waitForUser: what it asks for", () => {
  it("an approval is a user_approval with approve and reject; review and input are user_input with submit", async () => {
    for (const [kind, reason, allow] of [
      ["approval", "user_approval", ["approve", "reject"]],
      ["review", "user_input", ["submit"]],
      ["input", "user_input", ["submit"]],
    ] as const) {
      const { ctx, asked } = ctxThat({ returns: "ok" });
      await waitForUserOn(ctx, { kind, prompt: "Which region?" });
      expect(asked[0]).toMatchObject({ reason, kind, message: "Which region?", allow });
      // The one predicate every reader keys on says it waits for a user, of this kind.
      expect(isUserSuspension(asked[0]!)).toBe(true);
      expect(waitForUserKindOf(asked[0]!)).toBe(kind);
    }
  });

  it("has no deadline unless the call or the host sets one, and the call's wins (epic D3)", async () => {
    const none = ctxThat({ returns: "ok" });
    await waitForUserOn(none.ctx, { kind: "input", prompt: "?" });
    expect(none.asked[0]!.timeoutMs).toBeUndefined();

    const host = ctxThat({ returns: "ok" }, { userDeadlineMs: 7_777 });
    await waitForUserOn(host.ctx, { kind: "input", prompt: "?" });
    expect(host.asked[0]!.timeoutMs).toBe(7_777);

    const call = ctxThat({ returns: "ok" }, { userDeadlineMs: 7_777 });
    await waitForUserOn(call.ctx, { kind: "approval", prompt: "?", deadline: 1_234 });
    expect(call.asked[0]!.timeoutMs).toBe(1_234);
  });

  it("refuses a deadline that is not a positive number, before it suspends", async () => {
    const { ctx, asked } = ctxThat({ returns: "ok" });
    await expect(waitForUserOn(ctx, { kind: "input", prompt: "?", deadline: 0 })).rejects.toThrow(/deadline/);
    expect(asked).toEqual([]);
  });
});

describe("waitForUser: how it comes back", () => {
  it("an answer comes back as the answer; an approval's yes with approved", async () => {
    expect(await waitForUserOn(ctxThat({ returns: "eu-west" }).ctx, { kind: "input", prompt: "?" })).toEqual({
      cancelled: false,
      answer: "eu-west",
    });
    expect(await waitForUserOn(ctxThat({ returns: undefined }).ctx, { kind: "approval", prompt: "?" })).toEqual({
      cancelled: false,
      approved: true,
      answer: undefined,
    });
  });

  it("a no is approved: false, not at its deadline; a no at the deadline says so (D1)", async () => {
    const no = new SuspensionRejectedError("s1", "u1", { why: "not yet" });
    expect(await waitForUserOn(ctxThat({ throws: no }).ctx, { kind: "approval", prompt: "?" })).toEqual({
      cancelled: false,
      approved: false,
      deadline: false,
      answer: { why: "not yet" },
    });
    const expired = new SuspensionRejectedError("s1", "durability-sweeper", undefined, { expired: true });
    expect(await waitForUserOn(ctxThat({ throws: expired }).ctx, { kind: "approval", prompt: "?" })).toMatchObject({
      approved: false,
      deadline: true,
    });
  });

  it("a review's or an input's deadline throws SuspensionTimeoutError, which the block may catch (D1)", async () => {
    for (const kind of ["review", "input"] as const) {
      const timedOut = ctxThat({ throws: new SuspensionTimeoutError("s1") });
      await expect(waitForUserOn(timedOut.ctx, { kind, prompt: "?" })).rejects.toBeInstanceOf(SuspensionTimeoutError);
      // A rejection marked expired, should a runtime send one, is the same deadline.
      const expired = ctxThat({ throws: new SuspensionRejectedError("s1", undefined, undefined, { expired: true }) });
      await expect(waitForUserOn(expired.ctx, { kind, prompt: "?" })).rejects.toBeInstanceOf(SuspensionTimeoutError);
    }
  });

  it("a cancel comes back as { cancelled: true } for every kind, never as an answer or a throw", async () => {
    for (const kind of ["approval", "review", "input"] as const) {
      const cancelled = new SuspensionRejectedError("s1", "cancel", undefined, { cancelled: true });
      expect(await waitForUserOn(ctxThat({ throws: cancelled }).ctx, { kind, prompt: "?" })).toEqual({ cancelled: true });
    }
  });

  it("lets any other error through: the suspension itself, and a host without durable execution", async () => {
    const parked = new Error("parked");
    await expect(waitForUserOn(ctxThat({ throws: parked }).ctx, { kind: "input", prompt: "?" })).rejects.toBe(parked);
    await expect(waitForUserOn({}, { kind: "input", prompt: "?" })).rejects.toThrow(/durable host/);
  });
});

describe("isUserSuspension", () => {
  it("is a user's for the two person reasons only: never a wait, an external event or a custom reason", () => {
    expect(isUserSuspension({ reason: "user_approval" })).toBe(true);
    expect(isUserSuspension({ reason: "user_input" })).toBe(true);
    for (const reason of ["external_event", "wait", "ask", "my_own_reason"]) expect(isUserSuspension({ reason })).toBe(false);
    // A raw suspension with no kind reads its kind from its reason.
    expect(waitForUserKindOf({ reason: "user_approval" })).toBe("approval");
    expect(waitForUserKindOf({ reason: "user_input" })).toBe("input");
    expect(waitForUserKindOf({ reason: "external_event", kind: "input" })).toBeUndefined();
  });
});
