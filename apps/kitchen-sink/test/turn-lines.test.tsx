// @vitest-environment happy-dom
/**
 * Flow State mode's failed turn: the registry's failed line, with Retry on
 * the turns the other apps offer it on. `conversationLines` decides that from
 * the session's turns: the newest turn that drew a line, when the engine runs
 * it again (`retryable`). That only the newest group offers it is the
 * registry's own contract, tested with `RequestGroupRenderer` in packages/ui.
 *
 * Why each case matters: a Retry on a turn the engine won't run again (one a
 * notification started) is a button that answers 409; a Retry on an older
 * turn runs the newest one instead (`resumeLatestRequest`); a refused retry
 * shown on the line and in the page's box is one failure said twice; a
 * refused send has no line, so the box is its only place.
 *
 * Red states produced before these were trusted:
 *   - ignore the engine's flag (`retryable: true`): the notification case fails.
 *   - give `retry` while a turn runs, or read `retryable` whatever the
 *     request's status: the running case fails.
 *   - pass `shownError: session.error` through: the refused-retry case fails.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ErrorItem, MessageItem, OutputItem } from "@flow-state-dev/core/items";
import { FlowProvider } from "@flow-state-dev/react";

import { useTurnLines } from "../components/chat-agent/turn-lines";
import { FailedLine, LineContext } from "../components/flow-state/conversation-lines";
import { RequestGroupRenderer } from "../components/flow-state/request-group";

afterEach(cleanup);

function asked(requestId: string): MessageItem {
  return {
    id: `msg_${requestId}`,
    type: "message",
    role: "user",
    status: "completed",
    requestId,
    ts: 1,
    content: [{ type: "input_text", text: `ask ${requestId}` }],
  } as unknown as MessageItem;
}

/** An error item shaped the way `runAction.ts` writes one for a failed request. */
function failed(requestId: string, message = "No API key: set AI_GATEWAY_API_KEY"): ErrorItem {
  return { id: `err_${requestId}`, type: "error", status: "failed", requestId, message, code: "PROVIDER_ERROR", ts: 2 } as ErrorItem;
}

type Session = Parameters<typeof useTurnLines>[0];

function fakeSession(overrides: Partial<Session> = {}, latest: Partial<NonNullable<Session["latestRequest"]>> = {}): Session {
  return {
    latestRequest: { id: "req_2", status: "failed", retryable: true, ...latest } as Session["latestRequest"],
    isStreaming: false,
    isFinishing: false,
    resumeLatestRequest: vi.fn(async () => {}),
    error: null,
    ...overrides,
  };
}

const RENDERERS = { error: FailedLine, message: () => null };

/** The chat panel's wiring, as the page does it: the turns, the line context, the stream's groups, the box. */
function Panel({ session, items }: { session: Session; items: OutputItem[] }) {
  const { turns, lineContext, shownError } = useTurnLines(session, "Assistant");
  return (
    <FlowProvider renderers={RENDERERS}>
      <LineContext.Provider value={lineContext}>
        <RequestGroupRenderer items={items} isStreaming={session.isStreaming} turns={turns} />
        {shownError && <div data-testid="error-box">{shownError.message}</div>}
      </LineContext.Provider>
    </FlowProvider>
  );
}

const twoFailedTurns = (): OutputItem[] => [asked("req_1"), failed("req_1", "first failure"), asked("req_2"), failed("req_2")];
const lineOf = (requestId: string) => document.querySelector(`[data-request-id="${requestId}"] [data-line="failed"]`)!;

describe("Flow State mode's failed turn", () => {
  it("draws the reason under the worker with Retry on the newest turn, and Retry runs it again", async () => {
    const session = fakeSession();
    render(<Panel session={session} items={[asked("req_2"), failed("req_2")]} />);

    const line = screen.getByTestId("request-recovery");
    expect(line.getAttribute("data-state")).toBe("failed");
    expect(line.textContent).toContain("Assistant couldn't finish this turn");
    expect(line.textContent).toContain("No API key: set AI_GATEWAY_API_KEY");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    });
    expect(session.resumeLatestRequest).toHaveBeenCalledTimes(1);
  });

  it("offers no Retry on a turn the engine won't run again", () => {
    render(<Panel session={fakeSession({}, { retryable: false })} items={[asked("req_2"), failed("req_2")]} />);
    expect(screen.getByTestId("request-recovery").textContent).toContain("No API key");
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("keeps the reason on an older failed turn, without Retry", () => {
    render(<Panel session={fakeSession()} items={twoFailedTurns()} />);
    expect(lineOf("req_1").textContent).toContain("first failure");
    expect(lineOf("req_1").querySelector("button")).toBeNull();
    expect(lineOf("req_2").querySelector("button")).not.toBeNull();
  });

  it("draws no Retry while a turn runs, or once the newest turn is no longer failed", () => {
    const items = [asked("req_2"), failed("req_2")];
    const { rerender } = render(<Panel session={fakeSession({ isStreaming: true })} items={items} />);
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();

    rerender(<Panel session={fakeSession({ isFinishing: true })} items={items} />);
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();

    // An error item on a request that still completed: `resumeLatestRequest` won't run it.
    rerender(<Panel session={fakeSession({}, { status: "completed" })} items={items} />);
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();

    // A retry's new request is the newest turn; the failed one is older now.
    rerender(<Panel session={fakeSession({}, { id: "req_3", status: "completed" })} items={[...items, asked("req_3")]} />);
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("shows a refused retry once, on the line, not in the page's box", async () => {
    const refusal = new Error("409 request is not retryable");
    let session = fakeSession({ resumeLatestRequest: vi.fn(async () => Promise.reject(refusal)) });
    const items = [asked("req_2"), failed("req_2")];
    const { rerender } = render(<Panel session={session} items={items} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    });
    // `useSession` sets `error` to the same error it rejects with.
    session = { ...session, error: refusal };
    rerender(<Panel session={session} items={items} />);

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
