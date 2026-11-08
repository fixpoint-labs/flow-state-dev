// @vitest-environment happy-dom
/**
 * Every way the page sends a line of the user's tells the conversation's feeds
 * it is going out, so the line rises when it lands. A voice line goes through
 * `useVoice`, which calls `session.sendAction`, and Retry through
 * `resumeLatestRequest`, so both take the session `useSendingSession` returns.
 * Without it, a voice line and its reply land below the view (the conversation
 * no longer scrolls to every new request).
 *
 * The page draws a conversation in both responsive trees, each with its own
 * feed, so a send is told through one signal every drawing's feed hears.
 *
 * The feed's `sent` is a spy; the hook's own rule is `useJumpToLatest`'s, tested there.
 */
import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sent = vi.fn();
let feeds = 0;
vi.mock("@flow-state-dev/react", async (importOriginal) => {
  const { useRef: ref } = await import("react");
  return {
    ...(await importOriginal<typeof import("@flow-state-dev/react")>()),
    useJumpToLatest: () => {
      const id = ref(++feeds).current;
      return ref({ ref: () => undefined, atEnd: true, jump: () => undefined, sent: () => sent(id), mine: (key: string) => ({ "data-sent-line": key }) }).current;
    },
  };
});

const { useSendingSession, useSendSignal, useSignalledFeed } = await import("@/components/chat-feed");

afterEach(() => sent.mockClear());

/** A session whose calls record, in order, when they ran beside a notify. */
function session(order: string[]) {
  return {
    sendAction: vi.fn(async (..._args: unknown[]) => {
      order.push("sendAction");
      return {} as never;
    }),
    resumeLatestRequest: vi.fn(async () => {
      order.push("resumeLatestRequest");
    }),
  };
}

describe("the session a line-sending call takes", () => {
  it("tells the signal as a voice line goes out, before the send", async () => {
    const order: string[] = [];
    const s = session(order);
    const { result } = renderHook(() => {
      const signal = useSendSignal();
      useRef(signal.listen(() => order.push("sent")));
      return useSendingSession(s, signal);
    });
    await result.current.sendAction("run", { message: "hello" }, { metadata: { voice: {} } });
    expect(order).toEqual(["sent", "sendAction"]);
    expect(s.sendAction).toHaveBeenCalledWith("run", { message: "hello" }, { metadata: { voice: {} } });
  });

  it("tells the signal as Retry runs the failed turn again", async () => {
    const order: string[] = [];
    const s = session(order);
    const { result } = renderHook(() => {
      const signal = useSendSignal();
      useRef(signal.listen(() => order.push("sent")));
      return useSendingSession(s, signal);
    });
    await result.current.resumeLatestRequest();
    expect(order).toEqual(["sent", "resumeLatestRequest"]);
  });
});

describe("a drawing's feed", () => {
  it("hears every send, as does each other drawing of the same conversation", () => {
    const { result } = renderHook(() => {
      const signal = useSendSignal();
      return { signal, a: useSignalledFeed("s1", signal), b: useSignalledFeed("s1", signal) };
    });
    expect(sent).not.toHaveBeenCalled();
    act(() => result.current.signal.notify());
    expect(sent.mock.calls.map(([id]) => id).sort()).toHaveLength(2);
    expect(new Set(sent.mock.calls.map(([id]) => id)).size).toBe(2);
  });
});
