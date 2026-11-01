// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { act, renderHook } from "@testing-library/react";

import { clearDraft, readDraft, saveDraft, useDraft } from "../src/hooks/useDraft";

/** Kitchen Sink's namespace: the key its own copy of this hook wrote, so drafts stored then still read. */
const NS = "kitchen-sink:composer-draft";
const SESSION_DRAFT_STORAGE_PREFIX = `${NS}:`;
const useSessionDraft = (id: string | undefined) => useDraft(NS, id);

afterEach(() => {
  localStorage.clear();
});

/** Mirrors assistant/harness composers: clear the draft only after sendAction succeeds. */
function useSendOnSuccess(sessionId: string | undefined, send: () => Promise<void>) {
  const [draft, setDraft] = useSessionDraft(sessionId);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const submit = async (text: string) => {
    if (sessionId == null || text.trim().length === 0) return;
    const sent = text.trim();
    try {
      await send();
      // The box may have closed (a session switch) while it ran: storage goes only if it still holds this line.
      clearDraft(NS, sessionId, sent);
      if (draftRef.current.trim() === sent) setDraft("");
    } catch {
      // keep draft
    }
  };
  return { draft, setDraft, submit };
}

describe("useDraft", () => {
  it("reads a draft Kitchen Sink stored before the hook moved here", () => {
    localStorage.setItem("kitchen-sink:composer-draft:sess-old", "typed last week");
    const { result } = renderHook(() => useDraft("kitchen-sink:composer-draft", "sess-old"));
    expect(result.current[0]).toBe("typed last week");
  });

  it("keeps namespaces apart: one app's draft for an id is not another's", () => {
    const a = renderHook(() => useDraft("app-a:draft", "s1"));
    act(() => a.result.current[1]("for app a"));
    const b = renderHook(() => useDraft("app-b:draft", "s1"));
    expect(b.result.current[0]).toBe("");
  });

  it("restores text saved for a session", () => {
    localStorage.setItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-a", "half written");

    const { result } = renderHook(() => useSessionDraft("sess-a"));
    expect(result.current[0]).toBe("half written");
  });

  it("writes on change and clears storage when emptied", () => {
    const { result, rerender } = renderHook(({ id }: { id: string }) => useSessionDraft(id), {
      initialProps: { id: "sess-a" },
    });

    act(() => result.current[1]("draft one"));
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-a")).toBe("draft one");

    rerender({ id: "sess-b" });
    expect(result.current[0]).toBe("");

    act(() => result.current[1]("for b"));
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-b")).toBe("for b");

    rerender({ id: "sess-a" });
    expect(result.current[0]).toBe("draft one");

    act(() => result.current[1](""));
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-a")).toBeNull();
  });

  it("keeps text typed before the session id is known, then persists it", () => {
    const { result, rerender } = renderHook(({ id }: { id: string | undefined }) => useSessionDraft(id), {
      initialProps: { id: undefined as string | undefined },
    });

    act(() => result.current[1]("early typing"));
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-new")).toBeNull();

    rerender({ id: "sess-new" });
    expect(result.current[0]).toBe("early typing");
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-new")).toBe("early typing");
  });

  it("keeps the draft when send fails and clears it after success", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("door refused")).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useSendOnSuccess("sess-a", send));

    act(() => result.current.setDraft("retry me"));
    await act(async () => {
      await result.current.submit("retry me");
    });
    expect(result.current.draft).toBe("retry me");
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-a")).toBe("retry me");

    await act(async () => {
      await result.current.submit("retry me");
    });
    expect(result.current.draft).toBe("");
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-a")).toBeNull();
  });

  it("does not clear the visible draft for session B when a send for session A settles late", async () => {
    let resolveSend!: () => void;
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const { result, rerender } = renderHook(({ id }: { id: string | undefined }) => useSendOnSuccess(id, send), {
      initialProps: { id: "sess-a" as string | undefined },
    });

    act(() => result.current.setDraft("for a"));
    let submitDone: Promise<void> | undefined;
    act(() => {
      submitDone = result.current.submit("for a");
    });

    rerender({ id: "sess-b" });
    act(() => result.current.setDraft("for b"));

    await act(async () => {
      resolveSend();
      await submitDone;
    });

    expect(result.current.draft).toBe("for b");
  });

  it("clears storage for session A without changing session B's in-memory draft", () => {
    const { result, rerender } = renderHook(({ id }: { id: string | undefined }) => useSessionDraft(id), {
      initialProps: { id: "sess-a" },
    });

    act(() => result.current[1]("for a"));
    const setForA = result.current[1];
    rerender({ id: "sess-b" });
    act(() => result.current[1]("for b"));
    act(() => setForA(""));

    expect(result.current[0]).toBe("for b");
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-a")).toBeNull();
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-b")).toBe("for b");
  });

  it("keeps revised text when send succeeds after the user edited during the request", async () => {
    let resolveSend!: () => void;
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const { result } = renderHook(() => useSendOnSuccess("sess-a", send));

    act(() => result.current.setDraft("original"));
    let submitDone: Promise<void> | undefined;
    act(() => {
      submitDone = result.current.submit("original");
    });
    act(() => result.current.setDraft("revised while waiting"));

    await act(async () => {
      resolveSend();
      await submitDone;
    });

    expect(result.current.draft).toBe("revised while waiting");
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-a")).toBe("revised while waiting");
  });

  it("ignores a setter called after the box closed, so a late send can't wipe the draft of the box opened since", () => {
    const first = renderHook(() => useSessionDraft("sess-a"));
    act(() => first.result.current[1]("sent line"));
    const lateSetter = first.result.current[1];
    first.unmount();
    const again = renderHook(() => useSessionDraft("sess-a"));
    act(() => again.result.current[1]("revised after reopening"));

    act(() => lateSetter(""));

    expect(again.result.current[0]).toBe("revised after reopening");
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-a")).toBe("revised after reopening");
  });

  it("drops the stored line when its send lands after the box closed, and keeps one typed in the box opened since", async () => {
    const gates: Array<() => void> = [];
    const send = () => new Promise<void>((resolve) => gates.push(resolve));

    const first = renderHook(() => useSendOnSuccess("sess-a", send));
    act(() => first.result.current.setDraft("landed later"));
    let done!: Promise<void>;
    act(() => {
      done = first.result.current.submit("landed later");
    });
    first.unmount();
    await act(async () => {
      gates[0]();
      await done;
    });
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-a")).toBeNull();

    const second = renderHook(() => useSendOnSuccess("sess-a", send));
    act(() => second.result.current.setDraft("sent, then closed"));
    act(() => {
      done = second.result.current.submit("sent, then closed");
    });
    second.unmount();
    const third = renderHook(() => useSendOnSuccess("sess-a", send));
    act(() => third.result.current.setDraft("sent, then closed, then revised"));
    await act(async () => {
      gates[1]();
      await done;
    });
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-a")).toBe("sent, then closed, then revised");
    expect(third.result.current.draft).toBe("sent, then closed, then revised");
  });

  it("saveDraft stores a draft with no box open, and the box opened next reads it", () => {
    saveDraft(NS, "sess-a", "stored while closed");
    expect(readDraft(NS, "sess-a")).toBe("stored while closed");
    const { result } = renderHook(() => useSessionDraft("sess-a"));
    expect(result.current[0]).toBe("stored while closed");
    saveDraft(NS, "sess-a", "");
    expect(readDraft(NS, "sess-a")).toBe("");
  });

  it("clearDraft with the sent text drops the stored draft only while it is still that text", () => {
    localStorage.setItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-a", "revised");
    clearDraft(NS, "sess-a", "sent line");
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-a")).toBe("revised");
    clearDraft(NS, "sess-a", "revised");
    expect(localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + "sess-a")).toBeNull();
  });
});
