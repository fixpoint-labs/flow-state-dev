// @vitest-environment happy-dom
/**
 * `useAction({ action, result: true })`: a React screen reads what the action
 * answered from the hook that sent it (FIX-2455 D3). `execute` resolves to
 * `request.result()`'s shape, `loading` holds until the request settles, and
 * an unmount stops the wait without stopping the run. Without the option,
 * `execute` resolves on acceptance, as before. Driven through the hook's own
 * client over a recording fetcher, so the assertion is on what left the hook.
 */
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ClientFetch } from "@flow-state-dev/client";
import { FlowProvider, useAction } from "../src";

afterEach(cleanup);

const accepted = {
  status: "in_progress",
  request: { id: "req_1", flowKind: "demo", actionName: "summarize", status: "in_progress" },
  session: { id: "sess_1" }
};

/**
 * Accepts the send, then answers the status route `in_progress` until
 * `settle()` is called, then `completed` with the stored output.
 */
function server() {
  let settled = false;
  const urls: string[] = [];
  const fetcher = vi.fn<ClientFetch>(async (input, init) => {
    const url = String(input);
    urls.push(`${init?.method ?? "GET"} ${url}`);
    const body = url.includes("/actions/")
      ? accepted
      : settled
        ? {
            id: "req_1",
            status: "completed",
            startedAtMs: 1,
            ageMs: 1,
            ...(url.includes("include_result_output=true")
              ? { result: { output: { summary: "short" }, hasOutput: true } }
              : {})
          }
        : { id: "req_1", status: "in_progress", startedAtMs: 1, ageMs: 0, lastHeartbeatAt: 1 };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(FlowProvider, { flowKind: "demo", userId: "u1", fetcher, children });
  return { wrapper, urls, settle: () => (settled = true) };
}

describe("useAction with result: true", () => {
  it("resolves execute to what the action answered, loading until it settles", async () => {
    const { wrapper, urls, settle } = server();
    const { result } = renderHook(() => useAction({ action: "summarize", result: true }), { wrapper });

    let execution!: Promise<unknown>;
    act(() => {
      execution = result.current.execute({ ticketId: "t1" }, "sess_1");
    });
    await waitFor(() => expect(urls.some((url) => url.includes("/status"))).toBe(true));
    // Accepted is not answered: the hook is still loading while the request runs.
    expect(result.current.loading).toBe(true);

    settle();
    await act(async () => {
      await expect(execution).resolves.toEqual({ status: "completed", output: { summary: "short" } });
    });
    expect(result.current.loading).toBe(false);
    expect(urls.at(-1)).toBe("GET /api/flows/demo/requests/req_1/status?include_result_output=true");
  });

  it("stops waiting on unmount, without asking the server to stop the run", async () => {
    const { wrapper, urls } = server();
    const { result, unmount } = renderHook(() => useAction({ action: "summarize", result: true }), {
      wrapper
    });

    let execution!: Promise<unknown>;
    act(() => {
      execution = result.current.execute({ ticketId: "t1" }, "sess_1");
    });
    await waitFor(() => expect(urls.some((url) => url.includes("/status"))).toBe(true));
    unmount();

    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
    const reads = urls.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(urls.length).toBe(reads);
    expect(urls.some((url) => url.includes("/abort"))).toBe(false);
  });
});

describe("useAction without result", () => {
  it("resolves execute on acceptance, as before", async () => {
    const { wrapper, urls } = server();
    const { result } = renderHook(() => useAction({ action: "summarize" }), { wrapper });

    await act(async () => {
      await expect(result.current.execute({ ticketId: "t1" }, "sess_1")).resolves.toEqual(accepted);
    });
    expect(urls.some((url) => url.includes("/status"))).toBe(false);
  });
});
