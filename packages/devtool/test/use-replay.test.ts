import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReplay } from "../src/react/hooks/use-replay";

describe("useReplay", () => {
  it("starts with no replay active", () => {
    const { result } = renderHook(() => useReplay());

    expect(result.current.isReplaying).toBe(false);
    expect(result.current.replayState.mode).toBeNull();
    expect(result.current.replayState.requestId).toBeNull();
  });

  it("replayFull sets mode and requestId", () => {
    const { result } = renderHook(() => useReplay());

    act(() => result.current.replayFull("req-42"));

    expect(result.current.isReplaying).toBe(true);
    expect(result.current.replayState.mode).toBe("full");
    expect(result.current.replayState.requestId).toBe("req-42");
  });

  it("replayFromCursor sets mode and startingAfter", () => {
    const { result } = renderHook(() => useReplay());

    act(() => result.current.replayFromCursor("req-42", 5));

    expect(result.current.replayState.mode).toBe("cursor");
    expect(result.current.replayState.requestId).toBe("req-42");
    expect(result.current.replayState.startingAfter).toBe(5);
  });

  it("simulateReconnect sets mode and lastEventId", () => {
    const { result } = renderHook(() => useReplay());

    act(() => result.current.simulateReconnect("req-42", "req-42:10"));

    expect(result.current.replayState.mode).toBe("reconnect");
    expect(result.current.replayState.requestId).toBe("req-42");
    expect(result.current.replayState.lastEventId).toBe("req-42:10");
  });

  it("clearReplay resets to initial state", () => {
    const { result } = renderHook(() => useReplay());

    act(() => result.current.replayFull("req-42"));
    expect(result.current.isReplaying).toBe(true);

    act(() => result.current.clearReplay());
    expect(result.current.isReplaying).toBe(false);
    expect(result.current.replayState.mode).toBeNull();
    expect(result.current.replayState.requestId).toBeNull();
  });

  it("switching replay modes overwrites the previous state", () => {
    const { result } = renderHook(() => useReplay());

    act(() => result.current.replayFull("req-1"));
    act(() => result.current.replayFromCursor("req-2", 3));

    expect(result.current.replayState.mode).toBe("cursor");
    expect(result.current.replayState.requestId).toBe("req-2");
    expect(result.current.replayState.startingAfter).toBe(3);
  });
});
