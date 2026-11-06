// @vitest-environment happy-dom
/**
 * Every way the chat panel sends a line of the user's tells the conversation's
 * feed it is going out, so the line rises when it lands. The composer does it
 * itself; a voice line goes through `useVoice`, which calls
 * `session.sendAction`, and Retry through `resumeLatestRequest`, so both take
 * the session `useChatFeed` returns. Without it, a voice line and its reply
 * land below the view (the conversation no longer scrolls to every new
 * request).
 *
 * The feed's `sent` is a spy; the hook's own rule is `useJumpToLatest`'s, tested there.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sent = vi.fn();
const feed = { ref: () => undefined, atEnd: true, jump: () => undefined, sent, mine: (key: string) => ({ "data-sent-line": key }) };
vi.mock("@flow-state-dev/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/react")>()),
  useJumpToLatest: () => feed,
}));

const { useChatFeed } = await import("@/components/chat-feed");

afterEach(() => sent.mockClear());

/** A session whose calls record, in order, when they ran beside `sent`. */
function session() {
  const order: string[] = [];
  sent.mockImplementation(() => order.push("sent"));
  return {
    order,
    sendAction: vi.fn(async (..._args: unknown[]) => {
      order.push("sendAction");
      return {} as never;
    }),
    resumeLatestRequest: vi.fn(async () => {
      order.push("resumeLatestRequest");
    }),
  };
}

describe("the chat panel's sends", () => {
  it("arm the feed as a voice line goes out, before the send", async () => {
    const s = session();
    const { result } = renderHook(() => useChatFeed(s, "s1"));
    await result.current.session.sendAction("run", { message: "hello" }, { metadata: { voice: {} } });
    expect(s.order).toEqual(["sent", "sendAction"]);
    expect(s.sendAction).toHaveBeenCalledWith("run", { message: "hello" }, { metadata: { voice: {} } });
  });

  it("arm the feed as Retry runs the failed turn again", async () => {
    const s = session();
    const { result } = renderHook(() => useChatFeed(s, "s1"));
    await result.current.session.resumeLatestRequest();
    expect(s.order).toEqual(["sent", "resumeLatestRequest"]);
  });

  it("leave the feed alone until something sends", () => {
    const s = session();
    renderHook(() => useChatFeed(s, "s1"));
    expect(sent).not.toHaveBeenCalled();
  });
});
