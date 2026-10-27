// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { SESSION_DRAFT_STORAGE_PREFIX, useSessionDraft } from "../lib/use-session-draft";

afterEach(() => {
  localStorage.clear();
});

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
});
