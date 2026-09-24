// @vitest-environment happy-dom
/**
 * "Hire another", as a person uses it: fill the form, press Hire, and see
 * either the seat's arrival (the host is told once) or the refusal.
 *
 * The first case runs against the real router with the assistant's own flow,
 * because what it guards is a session record: a hire must not land on the
 * conversation the person is chatting in. The rest stub `fetch`, because what
 * they guard is how the form reads a request's ending, in each shape the
 * server can answer an action in.
 *
 * Red states produced before these were trusted:
 *   - Post the hire on the panel's session (the assistant's conversation):
 *     the refused hire becomes that session's latest request.
 *   - Treat a stream that closes as a success: the stream that ends with no
 *     terminal status calls the host back and shows no failure.
 *   - Tell the host on any close: the failed hire calls the host back too.
 *   - Read only an inline event stream: the queued (202) answer reports a
 *     failure for a hire that completed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createResourceClient } from "@flow-state-dev/client";
import { FlowProvider } from "@flow-state-dev/react";
import { createMockModelResolver } from "@flow-state-dev/testing";

import chatAgentFlow from "../flows/chat-agent/flow";
import { SeatPane } from "../components/seat-pane";
import { KITCHEN_SINK_ORG_ID, resolveKitchenSinkPrincipal } from "../lib/kitchen-sink-principal";

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

type Fetch = (url: URL, init: RequestInit | undefined) => Promise<Response>;

/** Route this page's fetches to `handle`, with relative URLs resolved as a browser would. */
function stubFetch(handle: Fetch): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new URL(String(input), "http://test"), init)) as typeof fetch;
}

/** One request event, as the server frames it. */
function frame(sequence: number, event: Record<string, unknown>): string {
  return `id: ${sequence}\ndata: ${JSON.stringify({ stream: "request", requestId: "req-1", sequence_number: sequence, ts: 0, ...event })}\n\n`;
}

/** An event-stream body that sends `frames` and then ends, or stays open when `open`. */
function sse(frames: string[], open = false): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(new TextEncoder().encode(f));
      if (!open) controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const completed = [frame(1, { type: "request.in_progress", status: "in_progress" }), frame(2, { type: "request.completed", status: "completed" })];

/** The pane on a declared seat, its form opened and filled, and Hire pressed. */
function hire(options: { sessionId?: string; kind?: string; hireSessionId?: () => Promise<string> } = {}) {
  const onHired = vi.fn();
  const { container } = render(
    <FlowProvider flowKind="chat-agent" userId="devuser" baseUrl="">
      <SeatPane
        sessionId={options.sessionId ?? "panel-session"}
        orgId={KITCHEN_SINK_ORG_ID}
        kind={options.kind ?? "agent"}
        address="support.iris"
        resourceClient={createResourceClient({ baseUrl: "" })}
        hireSessionId={options.hireSessionId ?? (async () => "hire-session")}
        onHired={onHired}
      />
    </FlowProvider>,
  );
  const pane = within(container);
  fireEvent.click(pane.getByRole("button", { name: "Hire another" }));
  fireEvent.change(pane.getByLabelText("Seat id"), { target: { value: "support.pat" } });
  fireEvent.change(pane.getByLabelText("Instructions"), { target: { value: "Takes refunds." } });
  fireEvent.click(pane.getByRole("button", { name: "Hire" }));
  return { pane, onHired };
}

describe("a hire from the rail leaves the assistant's conversation alone", () => {
  it("runs on the hire session, so a refused hire is not the assistant session's latest request", async () => {
    const state = createFlowState({
      flows: { "chat-agent": chatAgentFlow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({}),
      resolvePrincipal: resolveKitchenSinkPrincipal,
    });
    const router = (await state.getRouter()) as Record<
      string,
      (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>
    >;
    const route: Fetch = (url, init) => {
      const path = url.pathname.replace(/^\/api\/flows\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
      return router[(init?.method ?? "GET").toUpperCase()]!(new Request(url, init), { params: { path } });
    };
    const open = async () => {
      const res = await route(new URL("http://test/api/flows/chat-agent/sessions"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "devuser" }),
      });
      return ((await res.json()) as { session: { id: string } }).session.id;
    };
    const detail = async (id: string) =>
      (await (await route(new URL(`http://test/api/flows/sessions/${id}`), undefined)).json()) as {
        session: { latestRequestId?: string };
      };
    stubFetch(route);

    const assistant = await open();
    const hireSession = await open();
    const before = await detail(assistant);

    // A kind this app does not carry, so the sequence refuses the hire.
    const { pane, onHired } = hire({ sessionId: assistant, kind: "no-such-kind", hireSessionId: async () => hireSession });
    await waitFor(() => expect(pane.getByRole("alert").textContent).toMatch(/carries no flow kind "no-such-kind"/));

    expect(onHired).not.toHaveBeenCalled();
    expect((await detail(assistant)).session.latestRequestId).toBe(before.session.latestRequestId);
    expect((await detail(hireSession)).session.latestRequestId).toBeDefined();
    await state.dispose();
  });
});

describe("how the form reads the end of a hire", () => {
  it("shows the refusal and does not tell the host when the request fails", async () => {
    stubFetch(async () =>
      sse([
        frame(1, { type: "item.added", item: { id: "e1", type: "error", message: "This organization already hired support.pat." } }),
        frame(2, { type: "request.failed", status: "failed" }),
      ]),
    );
    const { pane, onHired } = hire();
    await waitFor(() => expect(pane.getByRole("alert").textContent).toBe("This organization already hired support.pat."));
    expect(onHired).not.toHaveBeenCalled();
  });

  it("says the hire did not complete when the stream ends with no terminal status", async () => {
    stubFetch(async () => sse([frame(1, { type: "request.in_progress", status: "in_progress" })]));
    const { pane, onHired } = hire();
    await waitFor(() => expect(pane.getByRole("alert").textContent).toBe("The hire did not complete."));
    expect(onHired).not.toHaveBeenCalled();
  });

  it("tells the host exactly once when the request completes inline", async () => {
    const posts: string[] = [];
    stubFetch(async (url) => {
      posts.push(url.pathname);
      return sse(completed);
    });
    const { onHired } = hire();
    await waitFor(() => expect(onHired).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onHired).toHaveBeenCalledTimes(1);
    expect(posts).toEqual(["/api/flows/chat-agent/hire-session/actions/hireSeat"]);
  });

  it("follows a queued (202) answer to the request's own stream, and tells the host once", async () => {
    const seen: string[] = [];
    stubFetch(async (url, init) => {
      seen.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (init?.method === "POST") {
        return new Response(
          JSON.stringify({ status: "in_progress", request: { id: "req-1", flowKind: "chat-agent", actionName: "hireSeat", status: "in_progress" } }),
          { status: 202, headers: { "content-type": "application/json" } },
        );
      }
      return sse(completed);
    });
    const { pane, onHired } = hire();
    await waitFor(() => expect(onHired).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onHired).toHaveBeenCalledTimes(1);
    expect(pane.queryByRole("alert")).toBeNull();
    expect(seen).toEqual([
      "POST /api/flows/chat-agent/hire-session/actions/hireSeat",
      "GET /api/flows/chat-agent/requests/req-1/stream",
    ]);
  });

  it("lets Cancel stop waiting on a hire that has not ended, and resets the form", async () => {
    let aborted = false;
    stubFetch(async (_url, init) => {
      init?.signal?.addEventListener("abort", () => (aborted = true));
      return sse([frame(1, { type: "request.in_progress", status: "in_progress" })], true);
    });
    const { pane, onHired } = hire();
    await waitFor(() => expect(pane.getByRole("button", { name: "Hiring…" })).toBeTruthy());

    fireEvent.click(pane.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(pane.getByRole("button", { name: "Hire another" })).toBeTruthy());
    expect(aborted).toBe(true);
    expect(onHired).not.toHaveBeenCalled();
  });
});
