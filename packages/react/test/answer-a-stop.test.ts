// @vitest-environment happy-dom
/**
 * Which route a React screen answers a stop through, read off the stop
 * itself: a user's stop (`user_approval`, `user_input`) goes to the answer
 * route, which answers it whatever started the run; a developer's own
 * `ctx.suspend` with a custom reason goes to the resume route, the only one
 * that answers it. Driven through the hooks' own client over a recording
 * fetcher, so the assertion is on the request that left the hook.
 */
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ItemProvenance, SuspensionItem } from "@flow-state-dev/core/items";
import type { ClientFetch } from "@flow-state-dev/client";
import { FlowProvider, useApproval, useSuspensionForm } from "../src";

afterEach(cleanup);

const provenance: ItemProvenance = { blockName: "ask", blockInstanceId: "b1", phase: "main" };

function stop(overrides: Partial<SuspensionItem> = {}): SuspensionItem {
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
    message: "Allow it?",
    ...overrides
  } as SuspensionItem;
}

/** A fetcher that answers every POST 202 and records the path and body. */
function recording() {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetcher = vi.fn<ClientFetch>(async (input, init) => {
    posts.push({ path: new URL(String(input), "http://x").pathname, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ requestId: "req_1" }), { status: 202, headers: { "content-type": "application/json" } });
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(FlowProvider, { flowKind: "demo", userId: "u1", fetcher, children });
  return { posts, wrapper };
}

describe("useApproval with no resolver provider", () => {
  it("answers a user's stop through the answer route, with no resumedBy in the body", async () => {
    const { posts, wrapper } = recording();
    const { result } = renderHook(() => useApproval(stop()), { wrapper });
    await act(async () => {
      result.current.approve();
    });
    expect(posts).toEqual([{ path: "/api/flows/demo/requests/req_1/answer", body: { suspensionId: "sus_1", action: "approve" } }]);
    expect(result.current.resolvedStatus).toBe("approved");
  });

  it("resumes a developer's own custom-reason stop through the resume route, as before", async () => {
    const { posts, wrapper } = recording();
    const { result } = renderHook(() => useApproval(stop({ reason: "budget_check" })), { wrapper });
    await act(async () => {
      result.current.reject();
    });
    expect(posts).toEqual([{ path: "/api/flows/demo/requests/req_1/resume", body: { suspensionId: "sus_1", action: "reject" } }]);
    expect(result.current.resolvedStatus).toBe("rejected");
  });
});

describe("useSuspensionForm with no resolver provider", () => {
  it("submits a user's input through the answer route", async () => {
    const { posts, wrapper } = recording();
    const item = stop({ reason: "user_input", allow: ["submit"], resumeSchema: { type: "string" } } as Partial<SuspensionItem>);
    const { result } = renderHook(() => useSuspensionForm(item), { wrapper });
    act(() => {
      result.current.setValue("eu-west");
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(posts).toEqual([
      { path: "/api/flows/demo/requests/req_1/answer", body: { suspensionId: "sus_1", action: "submit", data: "eu-west" } }
    ]);
  });

  it("submits a custom-reason stop's form through the resume route", async () => {
    const { posts, wrapper } = recording();
    const item = stop({ reason: "budget_check", allow: ["submit"], resumeSchema: { type: "string" } } as Partial<SuspensionItem>);
    const { result } = renderHook(() => useSuspensionForm(item), { wrapper });
    act(() => {
      result.current.setValue("50");
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(posts.map((p) => p.path)).toEqual(["/api/flows/demo/requests/req_1/resume"]);
  });
});
