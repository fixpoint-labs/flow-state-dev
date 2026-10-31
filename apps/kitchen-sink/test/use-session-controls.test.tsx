// @vitest-environment happy-dom
/**
 * The assistant's mode, thinking style and features belong to the session: a
 * session that last ran in Build reopens in Build, with its artifact panel,
 * instead of resetting to Ask and running the next message in the wrong mode.
 */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { DEFAULT_FEATURES } from "../components/feature-selector";
import { useSessionControls, type RecordedSessionControls } from "../lib/use-session-controls";

type Props = { id: string | undefined; recorded: RecordedSessionControls | undefined };

const BUILD_RECORD: RecordedSessionControls = {
  currentMode: "build",
  thinkingStyle: "background-work",
  requestCount: 3,
  features: { biasCheck: true, search: false, fetch: true, crawl: false },
};

const NO_TURNS: RecordedSessionControls = { currentMode: "ask", thinkingStyle: "default", requestCount: 0 };

function render(initial: Props) {
  return renderHook(({ id, recorded }: Props) => useSessionControls(id, recorded), { initialProps: initial });
}

describe("useSessionControls", () => {
  it("reopens a session on the mode, style and features it last ran with", () => {
    const { result, rerender } = render({ id: "sess-a", recorded: undefined });
    expect(result.current.mode).toBe("ask");

    rerender({ id: "sess-a", recorded: BUILD_RECORD });
    expect(result.current.mode).toBe("build");
    expect(result.current.thinkingStyle).toBe("background-work");
    expect(result.current.features).toEqual(BUILD_RECORD.features);
  });

  it("opens a session with no turns on the defaults, not the previous session's choices", () => {
    const { result, rerender } = render({ id: "sess-a", recorded: BUILD_RECORD });
    expect(result.current.mode).toBe("build");

    rerender({ id: "sess-new", recorded: undefined });
    expect(result.current.mode).toBe("ask");
    expect(result.current.features).toEqual(DEFAULT_FEATURES);

    rerender({ id: "sess-new", recorded: NO_TURNS });
    expect(result.current.mode).toBe("ask");
    expect(result.current.thinkingStyle).toBe("default");
  });

  it("does not overwrite a choice made before the session's record arrived", () => {
    const { result, rerender } = render({ id: "sess-a", recorded: undefined });
    act(() => result.current.setMode("debate"));

    rerender({ id: "sess-a", recorded: BUILD_RECORD });
    expect(result.current.mode).toBe("debate");
  });

  it("keeps a choice made after seeding when the record refreshes", () => {
    const { result, rerender } = render({ id: "sess-a", recorded: BUILD_RECORD });
    act(() => result.current.setMode("interview"));

    rerender({ id: "sess-a", recorded: { ...BUILD_RECORD, requestCount: 4 } });
    expect(result.current.mode).toBe("interview");
  });

  it("seeds again when the user switches back to a session", () => {
    const { result, rerender } = render({ id: "sess-a", recorded: BUILD_RECORD });
    rerender({ id: "sess-b", recorded: NO_TURNS });
    expect(result.current.mode).toBe("ask");

    rerender({ id: "sess-a", recorded: BUILD_RECORD });
    expect(result.current.mode).toBe("build");
  });

  it("fills features a record leaves out from the defaults", () => {
    const { result } = render({ id: "sess-a", recorded: { ...BUILD_RECORD, features: { search: false } } });
    expect(result.current.features).toEqual({ ...DEFAULT_FEATURES, search: false });
  });
});
