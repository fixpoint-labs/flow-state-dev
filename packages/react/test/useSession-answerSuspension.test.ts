// @vitest-environment happy-dom
/**
 * `session.answerSuspension` answers a stop through the call its reason
 * belongs to, streamed from the POST: a user's stop through the client's
 * `answer`, a developer's own custom-reason stop through `resume`, and a stop
 * the session hasn't seen through `answer`. It sends no `resumedBy`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";

const { sessionsMock, requestMock } = vi.hoisted(() => ({
  sessionsMock: { get: vi.fn(), state: vi.fn(), requests: vi.fn(), children: vi.fn() },
  requestMock: { continue: vi.fn(), retry: vi.fn(), resume: vi.fn(), answer: vi.fn() }
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const { fakeClient } = await import("./support/fake-client");
  const noopSSE = () => ({ close() {}, get lastEventId() { return undefined; } });
  return {
    ...actual,
    createSSEClientFromResponse: noopSSE,
    createClient: () => fakeClient({ sessions: { ...sessionsMock }, flow: {}, request: requestMock, requestStream: noopSSE })
  };
});

import { useSession } from "../src/hooks/useSession";

function suspensionItem(suspensionId: string, reason: string, requestId = "req1") {
  return {
    id: `item_${requestId}_${suspensionId}`,
    type: "suspension",
    status: "completed",
    requestId,
    itemIndex: 0,
    provenance: { blockName: "ask", blockInstanceId: "b1", phase: "main" },
    ts: 0,
    suspensionId,
    reason,
    message: "?"
  };
}

function sseResponse(): Response {
  return { headers: new Headers({ "content-type": "text/event-stream" }), body: { cancel: () => Promise.resolve() } } as unknown as Response;
}

async function mountWith(items: unknown[]) {
  sessionsMock.state.mockResolvedValue({
    sessionId: "sess1",
    flowKind: "demo",
    clientData: {},
    items,
    pagination: { offset: 0, limit: 50, total: items.length, hasMore: false, nextOffset: 0 }
  });
  const view = renderHook(() => useSession("sess1", { flowKind: "demo" }));
  await waitFor(() => expect(view.result.current.items.length).toBe(items.length));
  return view;
}

describe("session.answerSuspension", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionsMock.get.mockResolvedValue({ id: "sess1", flowKind: "demo", userId: "devuser", createdAt: 0, updatedAt: 0 });
    sessionsMock.requests.mockResolvedValue([]);
    sessionsMock.children.mockResolvedValue([]);
    requestMock.answer.mockResolvedValue(sseResponse());
    requestMock.resume.mockResolvedValue(sseResponse());
  });
  afterEach(cleanup);

  it("answers a user's stop through answer, streamed, with no resumedBy", async () => {
    const { result } = await mountWith([suspensionItem("sus_user", "user_approval")]);
    await act(async () => {
      await result.current.answerSuspension({ suspensionId: "sus_user", requestId: "req1", action: "approve" });
    });
    expect(requestMock.answer).toHaveBeenCalledWith("req1", { suspensionId: "sus_user", action: "approve" });
    expect(requestMock.resume).not.toHaveBeenCalled();
  });

  it("resumes a developer's own custom-reason stop through resume", async () => {
    const { result } = await mountWith([suspensionItem("sus_own", "budget_check")]);
    await act(async () => {
      await result.current.answerSuspension({ suspensionId: "sus_own", requestId: "req1", action: "reject" });
    });
    expect(requestMock.resume).toHaveBeenCalledWith("req1", { suspensionId: "sus_own", action: "reject" });
    expect(requestMock.answer).not.toHaveBeenCalled();
  });

  it("keeps resumeSuspension as a deprecated alias: the same call, so old code answers the same way", async () => {
    const { result } = await mountWith([]);
    expect(result.current.resumeSuspension).toBe(result.current.answerSuspension);
  });

  it("answers a stop it hasn't seen as a user's", async () => {
    const { result } = await mountWith([suspensionItem("sus_other", "budget_check")]);
    await act(async () => {
      await result.current.answerSuspension({ suspensionId: "sus_unseen", requestId: "req1", action: "approve" });
    });
    expect(requestMock.answer).toHaveBeenCalledWith("req1", { suspensionId: "sus_unseen", action: "approve" });
  });

  it("reads the reason from the answered request's stop when another request reused its id", async () => {
    // Suspension ids are unique within a request only. An earlier run's custom
    // stop must not send a task's user stop with the same id through resume (404).
    const { result } = await mountWith([
      suspensionItem("sus_1", "budget_check", "req1"),
      suspensionItem("sus_1", "user_approval", "req2")
    ]);
    await act(async () => {
      await result.current.answerSuspension({ suspensionId: "sus_1", requestId: "req2", action: "approve" });
    });
    expect(requestMock.answer).toHaveBeenCalledWith("req2", { suspensionId: "sus_1", action: "approve" });
    expect(requestMock.resume).not.toHaveBeenCalled();
  });
});
