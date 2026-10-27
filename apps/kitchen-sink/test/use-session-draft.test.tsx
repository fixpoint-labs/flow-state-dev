// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { SESSION_DRAFT_STORAGE_PREFIX, useSessionDraft } from "../lib/use-session-draft";

afterEach(() => {
  localStorage.clear();
});

/** Mirrors assistant/harness composers: clear the draft only after sendAction succeeds. */
function useSendOnSuccess(sessionId: string | undefined, send: () => Promise<void>) {
  const [draft, setDraft] = useSessionDraft(sessionId);
  const submit = async (text: string) => {
    if (sessionId === undefined || text.trim().length === 0) return;
    try {
      await send();
      setDraft("");
    } catch {
      // keep draft
    }
  };
  return { draft, setDraft, submit };
}

describe("useSessionDraft", () => {
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
});
