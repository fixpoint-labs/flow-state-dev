// @vitest-environment happy-dom
/**
 * `useFlow({ worker })` lists only that worker's sessions and creates new ones
 * with it, so the server links each to the worker when it is created. Without
 * a worker the hook sends exactly what it always has.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { FlowProvider, useFlow } from "../src";

const ORIGIN = "https://api.test";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Sent = { method: string; url: URL; body?: Record<string, unknown> };

function stubServer(): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      sent.push({ method, url: new URL(String(input)), ...(body !== undefined ? { body } : {}) });
      const payload =
        method === "POST"
          ? { session: { id: "s_new", flowKind: "agent", userId: "u1", orgId: "o", createdAt: 1, updatedAt: 1 } }
          : { flows: [], sessions: [] };
      return new Response(JSON.stringify(payload), {
        status: method === "POST" ? 201 : 200,
        headers: { "content-type": "application/json" }
      });
    })
  );
  return sent;
}

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(FlowProvider, { flowKind: "agent", userId: "u1", baseUrl: ORIGIN, children });

describe("useFlow worker", () => {
  it("filters the listing by the worker and creates sessions with it", async () => {
    const sent = stubServer();
    renderHook(() => useFlow({ worker: "researcher", autoCreateSession: true }), { wrapper });

    await waitFor(() => expect(sent.some((r) => r.method === "POST")).toBe(true));
    await waitFor(() => expect(sent.filter((r) => r.url.pathname === "/api/flows/sessions")).toHaveLength(2));
    const listings = sent.filter((r) => r.url.pathname === "/api/flows/sessions");
    for (const listing of listings) expect(listing.url.searchParams.get("link")).toBe("researcher");
    const created = sent.find((r) => r.method === "POST");
    expect(created?.body?.link).toBe("researcher");
  });

  it("sends no link without a worker", async () => {
    const sent = stubServer();
    renderHook(() => useFlow({ autoCreateSession: true }), { wrapper });

    await waitFor(() => expect(sent.some((r) => r.method === "POST")).toBe(true));
    for (const r of sent) expect(r.url.searchParams.has("link")).toBe(false);
    expect(sent.find((r) => r.method === "POST")?.body).not.toHaveProperty("link");
  });
});

describe("useFlow worker change", () => {
  /** A server whose listing answers per worker: A has `sA`, B has whatever is given. */
  function stubListing(bSessions: string[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const link = url.searchParams.get("link");
        const ids = url.pathname === "/api/flows/sessions" ? (link === "A" ? ["sA"] : link === "B" ? bSessions : []) : [];
        const sessions = ids.map((id) => ({ id, flowKind: "agent", userId: "u1", createdAt: 1, updatedAt: 1, link }));
        return new Response(JSON.stringify({ flows: [], sessions }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );
  }

  it("drops the other worker's session when the new worker has none", async () => {
    stubListing([]);
    const { result, rerender } = renderHook(({ worker }) => useFlow({ worker }), {
      wrapper,
      initialProps: { worker: "A" }
    });
    await waitFor(() => expect(result.current.activeSessionId).toBe("sA"));
    rerender({ worker: "B" });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.sessions).toEqual([]));
    expect(result.current.activeSessionId).toBeUndefined();
  });

  it("selects the new worker's session when it has one", async () => {
    stubListing(["sB"]);
    const { result, rerender } = renderHook(({ worker }) => useFlow({ worker }), {
      wrapper,
      initialProps: { worker: "A" }
    });
    await waitFor(() => expect(result.current.activeSessionId).toBe("sA"));
    rerender({ worker: "B" });
    await waitFor(() => expect(result.current.activeSessionId).toBe("sB"));
  });
});
