// @vitest-environment happy-dom
/**
 * `FlowProvider`'s `apiPath` reaches every request the hooks send: a server
 * that mounts the flow API somewhere other than `/api/flows` is reachable
 * from the provider alone. Unset, every hook keeps requesting `/api/flows`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { FlowProvider, useAction, useFlow, useRequestStream, useSession } from "../src";

const ORIGIN = "https://api.test";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every pathname requested while the hooks mount, run one action and open a stream. */
async function requestedPaths(apiPath?: string): Promise<string[]> {
  const paths: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      paths.push(new URL(String(input)).pathname);
      return new Response(JSON.stringify({ flows: [], sessions: [], requests: [], children: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    })
  );

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(FlowProvider, { flowKind: "chat", userId: "u1", baseUrl: ORIGIN, apiPath, children });

  const { result } = renderHook(
    () => ({
      flow: useFlow(),
      action: useAction({ action: "send" }),
      session: useSession("s1"),
      stream: useRequestStream({ source: { requestId: "r1" } })
    }),
    { wrapper }
  );
  await act(async () => {
    await result.current.action.execute({}).catch(() => undefined);
  });
  await waitFor(() => {
    expect(paths).toContain(apiPath === undefined ? "/api/flows" : apiPath);
    expect(paths.some((path) => path.endsWith("/chat/requests/r1/stream"))).toBe(true);
  });
  return paths;
}

describe("FlowProvider apiPath", () => {
  it("keeps every hook on /api/flows when unset", async () => {
    const paths = await requestedPaths();
    expect(paths.length).toBeGreaterThan(3);
    for (const path of paths) expect(path).toMatch(/^\/api\/flows(\/|$)/);
  });

  it("sends every hook's requests to the mount it names", async () => {
    const paths = await requestedPaths("/flows");
    expect(paths.length).toBeGreaterThan(3);
    for (const path of paths) expect(path).toMatch(/^\/flows(\/|$)/);
  });
});
