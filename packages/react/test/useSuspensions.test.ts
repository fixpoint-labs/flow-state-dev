/**
 * Behavioral tests for useSuspensions (FIX-276).
 *
 * The react package has no DOM/render harness by convention (see the note in
 * useResourceCollectionItem-overlay.test.ts), so the hook's two testable units
 * are exercised directly as pure functions:
 *  - `deriveSuspensions` — the `useMemo` derivation over `session.items`.
 *  - `resolveSuspension` — the body the `approve`/`reject` callbacks wrap,
 *    covering the recovery-client call shape, in-flight tracking, and the
 *    capture-then-rethrow error contract.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  ItemProvenance,
  SuspensionItem,
  SuspensionResumeItem
} from "@flow-state-dev/core/items";
import type { ResumeSuspensionResult } from "@flow-state-dev/client";
import { deriveSuspensions, resolveSuspension } from "../src/hooks/useSuspensions";

const provenance: ItemProvenance = {
  blockName: "approve",
  blockInstanceId: "b1",
  phase: "main"
};

function suspension(overrides: Partial<SuspensionItem> = {}): SuspensionItem {
  return {
    id: "item_sus",
    type: "suspension",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance,
    ts: 0,
    suspensionId: "sus_1",
    reason: "human_approval",
    message: "Approve this draft?",
    ...overrides
  } as SuspensionItem;
}

function resume(overrides: Partial<SuspensionResumeItem> = {}): SuspensionResumeItem {
  return {
    id: "item_resume",
    type: "suspension_resume",
    status: "completed",
    requestId: "req_1",
    itemIndex: 1,
    provenance,
    ts: 1,
    suspensionId: "sus_1",
    resolution: "approved",
    resolvedBy: "user_1",
    resumeData: { ok: true },
    resolvedAt: 1,
    ...overrides
  };
}

describe("deriveSuspensions", () => {
  it("marks a suspension without a matching resume as pending", () => {
    const result = deriveSuspensions([suspension()]);

    expect(result.suspensions).toHaveLength(1);
    expect(result.pending).toHaveLength(1);
    const view = result.suspensions[0];
    expect(view.pending).toBe(true);
    expect(view.status).toBe("pending");
    expect(view.resumeData).toBeUndefined();
    expect(view.resolvedBy).toBeUndefined();
  });

  it("resolves a suspension from its matching suspension_resume item (approved)", () => {
    const result = deriveSuspensions([suspension(), resume()]);

    expect(result.pending).toHaveLength(0);
    const view = result.suspensions[0];
    expect(view.pending).toBe(false);
    expect(view.status).toBe("approved");
    expect(view.resumeData).toEqual({ ok: true });
    expect(view.resolvedBy).toBe("user_1");
  });

  it("resolves a suspension from its matching suspension_resume item (rejected)", () => {
    // A rejection also moves the suspension out of pending — status tracks the
    // resolution so the UI can show "Rejected" rather than hiding the item.
    const result = deriveSuspensions([
      suspension(),
      resume({ resolution: "rejected", resumeData: undefined, resolvedBy: "op_2" })
    ]);

    expect(result.pending).toHaveLength(0);
    const view = result.suspensions[0];
    expect(view.pending).toBe(false);
    expect(view.status).toBe("rejected");
    expect(view.resolvedBy).toBe("op_2");
  });

  it("filters by requestId", () => {
    const items = [
      suspension({ id: "a", suspensionId: "sus_a", requestId: "req_1" }),
      suspension({ id: "b", suspensionId: "sus_b", requestId: "req_2" })
    ];

    const result = deriveSuspensions(items, { requestId: "req_2" });

    expect(result.suspensions).toHaveLength(1);
    expect(result.suspensions[0].item.suspensionId).toBe("sus_b");
  });

  it("filters by reasons", () => {
    const items = [
      suspension({ id: "a", suspensionId: "sus_a", reason: "human_approval" }),
      suspension({ id: "b", suspensionId: "sus_b", reason: "human_input" })
    ];

    const result = deriveSuspensions(items, { reasons: ["human_input"] });

    expect(result.suspensions).toHaveLength(1);
    expect(result.suspensions[0].item.reason).toBe("human_input");
  });

  it("preserves stream order", () => {
    const items = [
      suspension({ id: "a", suspensionId: "sus_a", itemIndex: 0 }),
      suspension({ id: "b", suspensionId: "sus_b", itemIndex: 1 })
    ];

    const result = deriveSuspensions(items);

    expect(result.suspensions.map((v) => v.item.suspensionId)).toEqual([
      "sus_a",
      "sus_b"
    ]);
  });

  it("reflects isResolving from the in-flight set", () => {
    const busy = deriveSuspensions([suspension()], undefined, new Set(["sus_1"]));
    expect(busy.suspensions[0].isResolving).toBe(true);

    const idle = deriveSuspensions([suspension()], undefined, new Set());
    expect(idle.suspensions[0].isResolving).toBe(false);
  });
});

describe("resolveSuspension", () => {
  const okResult: ResumeSuspensionResult = {
    requestId: "req_2",
    originalRequestId: "req_1"
  };

  function harness() {
    const resumeSuspension = vi.fn().mockResolvedValue(okResult);
    const inFlight: string[] = [];
    const markStart = vi.fn((id: string) => inFlight.push(id));
    const markEnd = vi.fn((id: string) => {
      const i = inFlight.indexOf(id);
      if (i >= 0) inFlight.splice(i, 1);
    });
    const setError = vi.fn();
    return { resumeSuspension, inFlight, markStart, markEnd, setError };
  }

  it("calls resumeSuspension with (flowKind, item.requestId, body) for approve", async () => {
    const h = harness();
    const item = suspension({ requestId: "req_99" });

    const out = await resolveSuspension({
      recoveryClient: { resumeSuspension: h.resumeSuspension },
      flowKind: "chat",
      item,
      action: "approve",
      data: { note: "looks good" },
      resumedBy: "op_1",
      markStart: h.markStart,
      markEnd: h.markEnd,
      setError: h.setError
    });

    expect(out).toBe(okResult);
    expect(h.resumeSuspension).toHaveBeenCalledWith("chat", "req_99", {
      suspensionId: "sus_1",
      action: "approve",
      data: { note: "looks good" },
      resumedBy: "op_1"
    });
    expect(h.setError).toHaveBeenCalledWith(null);
  });

  it("sends action: reject for reject", async () => {
    const h = harness();

    await resolveSuspension({
      recoveryClient: { resumeSuspension: h.resumeSuspension },
      flowKind: "chat",
      item: suspension(),
      action: "reject",
      markStart: h.markStart,
      markEnd: h.markEnd,
      setError: h.setError
    });

    expect(h.resumeSuspension).toHaveBeenCalledWith(
      "chat",
      "req_1",
      expect.objectContaining({ action: "reject" })
    );
  });

  it("marks in-flight during the await and clears it after success", async () => {
    const h = harness();
    let resolveCall: (v: ResumeSuspensionResult) => void = () => {};
    h.resumeSuspension.mockReturnValue(
      new Promise<ResumeSuspensionResult>((res) => {
        resolveCall = res;
      })
    );

    const promise = resolveSuspension({
      recoveryClient: { resumeSuspension: h.resumeSuspension },
      flowKind: "chat",
      item: suspension(),
      action: "approve",
      markStart: h.markStart,
      markEnd: h.markEnd,
      setError: h.setError
    });

    expect(h.inFlight).toEqual(["sus_1"]);
    resolveCall(okResult);
    await promise;
    expect(h.inFlight).toEqual([]);
  });

  it("captures the error, rethrows, and still clears in-flight", async () => {
    const h = harness();
    const { ClientHttpError } = await import("@flow-state-dev/client");
    const err = new ClientHttpError("forbidden", { status: 403, body: {} });
    h.resumeSuspension.mockRejectedValue(err);

    await expect(
      resolveSuspension({
        recoveryClient: { resumeSuspension: h.resumeSuspension },
        flowKind: "chat",
        item: suspension(),
        action: "approve",
        markStart: h.markStart,
        markEnd: h.markEnd,
        setError: h.setError
      })
    ).rejects.toBe(err);

    expect(h.setError).toHaveBeenCalledWith(err);
    expect(h.inFlight).toEqual([]);
  });

  it("rethrows the same normalized Error it stores for a non-Error throw", async () => {
    const h = harness();
    h.resumeSuspension.mockRejectedValue("boom"); // non-Error rejection

    const rejection = await resolveSuspension({
      recoveryClient: { resumeSuspension: h.resumeSuspension },
      flowKind: "chat",
      item: suspension(),
      action: "approve",
      markStart: h.markStart,
      markEnd: h.markEnd,
      setError: h.setError
    }).then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e
    );

    // The value stored in the error slot and the value rethrown must be the
    // same object — they previously diverged for non-Error throws.
    const stored = h.setError.mock.calls.at(-1)?.[0];
    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).toBe(stored);
    expect((rejection as Error).message).toBe("boom");
    expect(h.inFlight).toEqual([]);
  });
});
