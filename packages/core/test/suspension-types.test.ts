/**
 * FIX-140: Durable execution types and suspension errors.
 *
 * Validates the core type contracts: RequestStatus union includes
 * "suspended", SuspensionRecord serializes cleanly, and the three
 * suspension error classes carry their metadata correctly.
 */
import { describe, it, expect } from "vitest";
import type {
  RequestStatus,
  SuspensionRecord,
  SuspensionStatus,
  SuspensionReason
} from "../src/types";
import {
  SuspensionError,
  SuspensionRejectedError,
  SuspensionTimeoutError
} from "../src/errors";

describe("RequestStatus", () => {
  it('"suspended" is a valid RequestStatus value', () => {
    const status: RequestStatus = "suspended";
    expect(status).toBe("suspended");
  });

  it("type-narrowing works for suspended status", () => {
    const status: RequestStatus = "suspended";
    // Narrowing via equality — primarily a compile-time check that
    // "suspended" is assignable. Runtime confirms the value survives.
    if (status === "suspended") {
      expect(status).toBe("suspended");
    } else {
      throw new Error("narrowing failed");
    }
  });
});

describe("SuspensionRecord", () => {
  function makeRecord(overrides?: Partial<SuspensionRecord>): SuspensionRecord {
    return {
      suspensionId: "sus_1",
      requestId: "req_1",
      flowKind: "chat",
      actionName: "ask",
      userId: "user_1",
      reason: "human_approval" as SuspensionReason,
      message: "Please approve this action",
      status: "pending" as SuspensionStatus,
      blockInstanceId: "block_1",
      stepIndex: 2,
      createdAt: 1700000000000,
      ...overrides
    };
  }

  it("round-trips through JSON serialization", () => {
    const record = makeRecord({
      data: { amount: 500, currency: "USD" },
      resumeSchema: { type: "object", properties: { approved: { type: "boolean" } } },
      render: { component: "ApprovalCard", props: { title: "Confirm?" } },
      expiresAt: 1700000060000,
      sessionId: "sess_1"
    });

    const serialized = JSON.stringify(record);
    const parsed: SuspensionRecord = JSON.parse(serialized);

    expect(parsed).toEqual(record);
    expect(parsed.suspensionId).toBe("sus_1");
    expect(parsed.data).toEqual({ amount: 500, currency: "USD" });
    expect(parsed.render?.component).toBe("ApprovalCard");
  });

  it("round-trips with optional fields omitted", () => {
    const record = makeRecord();

    const parsed: SuspensionRecord = JSON.parse(JSON.stringify(record));

    expect(parsed).toEqual(record);
    expect(parsed.data).toBeUndefined();
    expect(parsed.sessionId).toBeUndefined();
    expect(parsed.expiresAt).toBeUndefined();
  });

  it("preserves resolved fields after resolution", () => {
    const record = makeRecord({
      status: "approved",
      resolvedAt: 1700000030000,
      resolvedBy: "admin_1",
      resumeData: { approved: true, note: "looks good" }
    });

    const parsed: SuspensionRecord = JSON.parse(JSON.stringify(record));

    expect(parsed.status).toBe("approved");
    expect(parsed.resolvedBy).toBe("admin_1");
    expect(parsed.resumeData).toEqual({ approved: true, note: "looks good" });
  });
});

describe("SuspensionError", () => {
  it("is instanceof Error", () => {
    const err = new SuspensionError({
      suspensionId: "sus_1",
      reason: "human_approval"
    });
    expect(err).toBeInstanceOf(Error);
  });

  it("carries suspension metadata", () => {
    const err = new SuspensionError({
      suspensionId: "sus_42",
      reason: "human_input",
      message: "Enter the code",
      data: { field: "otp" },
      resumeSchema: { type: "object" },
      timeoutMs: 60_000,
      render: { component: "OTPInput", props: { length: 6 } }
    });

    expect(err.name).toBe("SuspensionError");
    expect(err.suspensionId).toBe("sus_42");
    expect(err.reason).toBe("human_input");
    expect(err.message).toBe("Enter the code");
    expect(err.data).toEqual({ field: "otp" });
    expect(err.resumeSchema).toEqual({ type: "object" });
    expect(err.timeoutMs).toBe(60_000);
    expect(err.render).toEqual({ component: "OTPInput", props: { length: 6 } });
  });

  it("uses default message when none provided", () => {
    const err = new SuspensionError({
      suspensionId: "sus_1",
      reason: "external_event"
    });
    expect(err.message).toBe("Flow suspended: external_event");
  });
});

describe("SuspensionRejectedError", () => {
  it("is instanceof Error", () => {
    const err = new SuspensionRejectedError("sus_1");
    expect(err).toBeInstanceOf(Error);
  });

  it("carries rejection metadata", () => {
    const err = new SuspensionRejectedError("sus_99", "admin_2", { reason: "not authorized" });
    expect(err.name).toBe("SuspensionRejectedError");
    expect(err.suspensionId).toBe("sus_99");
    expect(err.rejectedBy).toBe("admin_2");
    expect(err.rejectionData).toEqual({ reason: "not authorized" });
    expect(err.message).toBe("Suspension sus_99 was rejected");
  });
});

describe("SuspensionTimeoutError", () => {
  it("is instanceof Error", () => {
    const err = new SuspensionTimeoutError("sus_1");
    expect(err).toBeInstanceOf(Error);
  });

  it("carries the suspensionId and formatted message", () => {
    const err = new SuspensionTimeoutError("sus_77");
    expect(err.name).toBe("SuspensionTimeoutError");
    expect(err.suspensionId).toBe("sus_77");
    expect(err.message).toBe("Suspension sus_77 timed out");
  });
});
