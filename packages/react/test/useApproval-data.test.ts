// @vitest-environment happy-dom
/**
 * An approval's answer can carry data (FIX-2389): a stop that offers more
 * than one yes lists them under `data.approveOptions`, each with the data its
 * yes sends, and `useApproval` sends that data with the approve (or a reject's
 * data with the reject). Driven through `renderHook` with a
 * SuspensionResolverProvider, so what reaches the resume is observed.
 */
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ItemProvenance, SuspensionItem } from "@flow-state-dev/core/items";
import { approveOptionsOf, useApproval, FlowProvider, SuspensionResolverProvider, type SuspensionResolver } from "../src";

afterEach(cleanup);

const provenance: ItemProvenance = { blockName: "ask", blockInstanceId: "b1", phase: "main" };

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
    reason: "user_approval",
    kind: "approval",
    message: "Allow it?",
    ...overrides
  } as SuspensionItem;
}

function wrapperWith(resolve: SuspensionResolver) {
  return ({ children }: { children: ReactNode }) =>
    createElement(FlowProvider, {
      flowKind: "demo",
      children: createElement(SuspensionResolverProvider, { resolve, children })
    });
}

describe("an approval whose yes carries data", () => {
  it("sends a yes's data with the approve", async () => {
    const resolve = vi.fn(async (_args: unknown) => {});
    const { result } = renderHook(() => useApproval(suspension()), { wrapper: wrapperWith(resolve) });
    await act(async () => {
      result.current.approveWith({ scope: "run" });
    });
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ action: "approve", data: { scope: "run" } }));
    expect(result.current.resolvedStatus).toBe("approved");
  });

  it("sends no data with a plain approve, and a reject's data with the reject", async () => {
    const resolve = vi.fn(async (_args: unknown) => {});
    const { result } = renderHook(() => useApproval(suspension()), { wrapper: wrapperWith(resolve) });
    await act(async () => {
      result.current.rejectWith({ note: "not here" });
    });
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ action: "reject", data: { note: "not here" } }));

    const plain = vi.fn(async (_args: unknown) => {});
    const second = renderHook(() => useApproval(suspension()), { wrapper: wrapperWith(plain) });
    await act(async () => {
      second.result.current.approve();
    });
    expect(plain.mock.calls[0]![0]).not.toHaveProperty("data");
  });

  it("sends no data when the plain approve is a click handler handed the click", async () => {
    // A card wires `onClick={approval.approve}`: the click event must not become the answer's data.
    const resolve = vi.fn(async (_args: unknown) => {});
    const { result } = renderHook(() => useApproval(suspension()), { wrapper: wrapperWith(resolve) });
    await act(async () => {
      (result.current.approve as (event: unknown) => void)({ type: "click" });
    });
    expect(resolve.mock.calls[0]![0]).not.toHaveProperty("data");
  });

  it("hands the data to a caller's own approve", async () => {
    const onApprove = vi.fn(async () => {});
    const { result } = renderHook(() => useApproval(suspension(), { onApprove }), { wrapper: wrapperWith(vi.fn()) });
    await act(async () => {
      result.current.approveWith({ scope: "run" });
    });
    expect(onApprove).toHaveBeenCalledWith({ scope: "run" });
  });
});

describe("the extra yeses a stop offers", () => {
  it("reads labelled options off the stop's data, and nothing that isn't one", () => {
    const item = suspension({
      data: { approveOptions: [{ label: "Allow for this run", data: { scope: "run" } }, { label: 3 }, "x"] }
    });
    expect(approveOptionsOf(item)).toEqual([{ label: "Allow for this run", data: { scope: "run" } }]);
    expect(approveOptionsOf(suspension())).toEqual([]);
    expect(approveOptionsOf(suspension({ data: { approveOptions: "nope" } }))).toEqual([]);
  });
});
