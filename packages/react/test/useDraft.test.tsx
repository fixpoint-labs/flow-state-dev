// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { act, renderHook } from "@testing-library/react";

import { useDraft } from "../src/hooks/useDraft";

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
});
