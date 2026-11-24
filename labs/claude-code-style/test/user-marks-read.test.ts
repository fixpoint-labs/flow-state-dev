// @vitest-environment happy-dom
/**
 * Your pins and dismissals are user resources, read by scope with no
 * session: a pin or a dismissal made anywhere (another tab, this one) reaches
 * every screen that reads them, and the sidebar's count of what waits on you
 * leaves out a failure you dismissed. On the lab's own host, in process.
 */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useDismissed, usePins } from "../src/app";
import { closeApps, openTestApp } from "./app-host";

afterEach(async () => {
  cleanup();
  await closeApps();
});

describe("your marks", () => {
  it("read with no session found or made, and again when another tab pins or dismisses", async () => {
    const lab = await openTestApp({ noProject: true });
    const sessions = async () => (await lab.client.sessions.list()).length;
    const before = await sessions();
    const marks = renderHook(() => ({ pins: usePins(), dismissed: useDismissed() }), { wrapper: ({ children }: { children: ReactNode }) => lab.wrap(children) });
    await waitFor(() => expect(marks.result.current).toEqual({ pins: [], dismissed: [] }));
    // The same calls another tab makes.
    await lab.calls.pin("t1");
    await lab.calls.dismiss({ id: "t2", attempts: 1 });
    await waitFor(() => expect(marks.result.current).toEqual({ pins: ["t1"], dismissed: ["t2#1"] }), { timeout: 10_000 });
    // A newer attempt's dismissal replaces the older one's; an unpin takes the pin away.
    await lab.calls.dismiss({ id: "t2", attempts: 2 });
    await lab.calls.unpin("t1");
    await waitFor(() => expect(marks.result.current).toEqual({ pins: [], dismissed: ["t2#2"] }), { timeout: 10_000 });
    expect(await sessions()).toBe(before);
  });
});
