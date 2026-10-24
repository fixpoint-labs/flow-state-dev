// @vitest-environment happy-dom
/**
 * A `FlowProvider` given a credential-adding `fetcher` and no `baseUrl` keeps
 * every hook's request on the page's own origin. The wrapper forwards the URL
 * to the browser's `fetch`, so an invented origin would send every read and
 * stream somewhere the page's server never answers.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { FlowProvider, useAction, useFlow, useRequestStream, useSession } from "../src";
import type { ClientFetch } from "@flow-state-dev/client";

afterEach(() => {
  cleanup();
});

describe("FlowProvider with a credential fetcher and no baseUrl", () => {
  it("sends every hook's request to the page's own origin, with the credential", async () => {
    const sent: Array<{ url: string; auth: string | null }> = [];
    // What a host writes: add a header, forward the URL unchanged.
    const authenticatedFetch: ClientFetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", "Bearer t1");
      sent.push({ url: String(input), auth: headers.get("authorization") });
      return new Response(JSON.stringify({ flows: [], sessions: [], requests: [], children: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(FlowProvider, { flowKind: "chat", userId: "u1", fetcher: authenticatedFetch, children });

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
      expect(sent.some(({ url }) => url.endsWith("/chat/requests/r1/stream"))).toBe(true);
    });

    expect(sent.length).toBeGreaterThan(3);
    for (const { url, auth } of sent) {
      // Resolved the way the browser's fetch resolves it.
      expect(new URL(url, window.location.href).origin).toBe(window.location.origin);
      expect(url).toMatch(/^\/api\/flows(\/|$|\?)/);
      expect(auth).toBe("Bearer t1");
    }
  });
});
