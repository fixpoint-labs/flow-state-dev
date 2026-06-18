/**
 * Tests for the default poll-Linear human gate. The load-bearing case is that an
 * unrecognized (custom/workspace) Linear state is treated as neither approve nor
 * reject — it must fall through to waiting rather than silently bouncing the spec.
 */
import { describe, expect, it } from "vitest";
import { createLinearHumanGate } from "../../src/driver/human-gate";
import { LinearStatusClient, type LinearTransport } from "../../src/signals/linear";
import type { SuspensionRecord } from "@flow-state-dev/core/types";

function ctxAt(state: string, now = 1_000, watchdogMs = 10_000) {
  const transport: LinearTransport = {
    getIssueState: async () => state,
    setIssueState: async () => {},
    comment: async () => {},
  };
  return { issueId: "FIX-1", linear: new LinearStatusClient(transport), now, watchdogMs };
}

const specGate = {
  suspensionId: "s",
  requestId: "r",
  flowKind: "dev-orchestrator",
  actionName: "spec",
  userId: "u",
  reason: "human_approval",
  message: "Approve?",
  data: { gate: "spec-approval" },
  status: "pending",
  blockInstanceId: "r:root",
  stepIndex: 2,
  createdAt: 0,
} as SuspensionRecord;

describe("createLinearHumanGate — spec approval", () => {
  const gate = createLinearHumanGate();

  it("approves once the board reaches Spec Approved", async () => {
    expect(await gate.poll(specGate, ctxAt("Spec Approved"))).toMatchObject({ ready: true, reject: false });
  });

  it("rejects when the human sends the board back to a known earlier state", async () => {
    expect(await gate.poll(specGate, ctxAt("In Spec Dev"))).toMatchObject({ ready: true, reject: true });
  });

  it("keeps waiting while the board sits at the gate threshold", async () => {
    expect(await gate.poll(specGate, ctxAt("In Spec Review"))).toMatchObject({ ready: false, timedOut: false });
  });

  it("does NOT reject on an unrecognized custom state — it keeps waiting", async () => {
    const decision = await gate.poll(specGate, ctxAt("Blocked"));
    expect(decision.ready).toBe(false);
    expect(decision.reject).toBe(false);
    expect(decision.timedOut).toBe(false);
  });

  it("times out when the watchdog elapses with no decision", async () => {
    expect(await gate.poll(specGate, ctxAt("In Spec Review", 20_000, 10_000))).toMatchObject({ timedOut: true });
  });
});
