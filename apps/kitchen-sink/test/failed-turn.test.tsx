// @vitest-environment happy-dom
/**
 * Flow State mode's failed turn: an `error` item draws
 * the request-recovery line with its reason, Retry shows only on the request
 * the session will retry, and a refused retry shows once.
 *
 * Why each case matters: a Retry drawn on a request `resumeLatestRequest`
 * won't retry is a button that does nothing; a refused retry shown both on
 * the line and in the page's box is a double failure; a refused send has
 * no line, so the box is its only place.
 *
 * Red states produced before these were trusted:
 *   - render the item with `ErrorDisplay` again: the reason-and-Retry case
 *     fails (no Retry button).
 *   - drop the `latestRequest.id === requestId` check: the older-turn case
 *     fails (Retry drawn on an older line).
 *   - pass `shownError: session.error` through: the refused-retry case fails
 *     (the box shows the refusal too).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ErrorItem } from "@flow-state-dev/core/items";

import {
  ChatAgentFailedTurn,
  FailedTurnRetryProvider,
  useFailedTurnRetry,
} from "../components/chat-agent/failed-turn";

afterEach(cleanup);

/** An error item shaped the way `runAction.ts` writes one for a failed request. */
function errorItem(requestId: string, message = "No API key: set AI_GATEWAY_API_KEY"): ErrorItem {
  return {
    id: `err_${requestId}`,
    type: "error",
    status: "failed",
    requestId,
    message,
    code: "PROVIDER_ERROR",
  } as ErrorItem;
}

type FakeSession = Parameters<typeof useFailedTurnRetry>[0];

function fakeSession(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    latestRequest: { id: "req_2", status: "failed" } as FakeSession["latestRequest"],
    isStreaming: false,
    isFinishing: false,
    resumeLatestRequest: vi.fn(async () => {}),
    error: null,
    ...overrides,
  };
}

/** The chat panel's wiring, as the page does it: the provider, the stream's lines, the box. */
function Panel({ session, items }: { session: FakeSession; items: ErrorItem[] }) {
  const { retryFor, shownError } = useFailedTurnRetry(session);
  return (
    <FailedTurnRetryProvider value={retryFor}>
      {items.map((item) => (
        <div key={item.id} data-testid={`line-${item.requestId}`}>
          <ChatAgentFailedTurn item={item} />
        </div>
      ))}
      {shownError && <div data-testid="error-box">{shownError.message}</div>}
    </FailedTurnRetryProvider>
  );
}

describe("Flow State mode's failed turn", () => {
  it("draws the reason, the worker and Retry on the newest failed request, and Retry retries it", async () => {
    const session = fakeSession();
    render(<Panel session={session} items={[errorItem("req_2")]} />);

    const line = screen.getByTestId("request-recovery");
    expect(line.getAttribute("data-state")).toBe("failed");
    expect(line.textContent).toContain("Assistant couldn't finish this turn");
    expect(line.textContent).toContain("No API key: set AI_GATEWAY_API_KEY");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    });
    expect(session.resumeLatestRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps the reason on an older failed turn, without Retry", () => {
    render(<Panel session={fakeSession()} items={[errorItem("req_1", "first failure"), errorItem("req_2")]} />);

    const older = screen.getByTestId("line-req_1");
    expect(older.textContent).toContain("first failure");
    expect(older.querySelector("button")).toBeNull();
    expect(screen.getByTestId("line-req_2").querySelector("button")).not.toBeNull();
  });

  it("draws no Retry while a turn runs, or once the newest request is no longer failed", () => {
    const { rerender } = render(<Panel session={fakeSession({ isStreaming: true })} items={[errorItem("req_2")]} />);
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();

    rerender(<Panel session={fakeSession({ isFinishing: true })} items={[errorItem("req_2")]} />);
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();

    rerender(
      <Panel
        session={fakeSession({ latestRequest: { id: "req_2", status: "completed" } as FakeSession["latestRequest"] })}
        items={[errorItem("req_2")]}
      />,
    );
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("shows a refused retry once, on the line, not in the page's box", async () => {
    const refusal = new Error("409 request is not retryable");
    let session = fakeSession({ resumeLatestRequest: vi.fn(async () => Promise.reject(refusal)) });
    const { rerender } = render(<Panel session={session} items={[errorItem("req_2")]} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    });
    // The hook sets `session.error` to the same error it rejects with.
    session = { ...session, error: refusal };
    rerender(<Panel session={session} items={[errorItem("req_2")]} />);

    await waitFor(() =>
      expect(screen.getByTestId("request-recovery").textContent).toContain("Retry failed: 409 request is not retryable"),
    );
    expect(screen.queryByTestId("error-box")).toBeNull();
  });

  it("keeps the page's box for an error no line carries, such as a refused send", () => {
    render(<Panel session={fakeSession({ error: new Error("Send refused: 503") })} items={[]} />);
    expect(screen.getByTestId("error-box").textContent).toBe("Send refused: 503");
  });
});
