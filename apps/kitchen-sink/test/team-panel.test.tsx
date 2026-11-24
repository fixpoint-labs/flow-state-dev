// @vitest-environment happy-dom
/**
 * The workers panel: it follows the roster, and its "Talk" opens one
 * conversation at a time.
 *
 * - The list is the workforce client's roster watch: each roster the watch
 *   reports redraws it, with no reload and no Retry; a failed read shows until
 *   a read lands. Red state produced: against the one-shot `roster()` read,
 *   the follow case never shows the hire.
 * - Opening a conversation may create a session, so a slow open holds every
 *   "Talk" until it settles: a double click, or a click on a second worker,
 *   must not start a second create. Red state produced: with the hold
 *   removed, the double-click case records two opens.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RosterEntry, WorkforceClient } from "@flow-state-dev/workforce/browser";

import { TeamPanel } from "../components/team-panel";

afterEach(cleanup);

const worker = (id: string): RosterEntry => ({
  id,
  flow: "support-desk",
  standard: true,
  description: null,
  name: null,
  teamName: null,
  forkedFrom: null,
  edited: false,
  settings: {},
});

/** A workforce client whose roster watch the test drives: `show` reports a roster, `fail` a failed read. */
function watched() {
  let onRoster: (entries: RosterEntry[]) => void = () => {};
  let onError: (error: unknown) => void = () => {};
  const stop = vi.fn();
  const workforce = {
    roster: async () => {
      throw new Error("the panel read the roster once instead of watching it");
    },
    watchRoster: (next: (entries: RosterEntry[]) => void, options?: { onError?: (error: unknown) => void }) => {
      onRoster = next;
      onError = options?.onError ?? (() => {});
      return stop;
    },
  } as unknown as WorkforceClient;
  return {
    workforce,
    stop,
    show: (entries: RosterEntry[]) => act(() => onRoster(entries)),
    fail: (error: Error) => act(() => onError(error)),
  };
}

const ids = () => screen.queryAllByTestId("roster-worker").map((row) => row.getAttribute("data-worker-id"));

describe("the workers panel follows the roster", () => {
  it("shows a hire and a fire the watch reports, with no reload, and stops the watch on unmount", async () => {
    const roster = watched();
    const { unmount } = render(<TeamPanel workforce={roster.workforce} onTalk={async () => {}} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    await roster.show([worker("coordinator"), worker("billing")]);
    expect(ids()).toEqual(["coordinator", "billing"]);
    await roster.show([worker("coordinator"), worker("billing"), worker("scribe")]);
    expect(ids()).toEqual(["coordinator", "billing", "scribe"]);
    await roster.show([worker("coordinator"), worker("scribe")]);
    expect(ids()).toEqual(["coordinator", "scribe"]);
    unmount();
    expect(roster.stop).toHaveBeenCalledTimes(1);
  });

  it("says a first read failed, with no Retry, and draws the roster once a read lands", async () => {
    const roster = watched();
    render(<TeamPanel workforce={roster.workforce} onTalk={async () => {}} />);
    await roster.fail(new Error("Bad Gateway"));
    expect(screen.getByRole("alert").textContent).toContain("The roster could not be read: Bad Gateway");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    await roster.show([worker("coordinator")]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(ids()).toEqual(["coordinator"]);
  });
});

describe("the workers panel's Talk", () => {
  it("opens one conversation for a double click, holds every Talk while it opens, and says why when it can't", async () => {
    const opened: string[] = [];
    let fail: ((failure: Error) => void) | undefined;
    const onTalk = (entry: RosterEntry) => {
      opened.push(entry.id);
      return new Promise<void>((_, reject) => (fail = reject));
    };
    const roster = watched();
    render(<TeamPanel workforce={roster.workforce} onTalk={onTalk} />);
    await roster.show([worker("coordinator"), worker("billing")]);
    const [first, second] = (await screen.findAllByTestId("roster-talk")) as HTMLButtonElement[];

    fireEvent.click(first);
    fireEvent.click(first);
    fireEvent.click(second);
    expect(opened).toEqual(["coordinator"]);
    expect(first.textContent).toBe("Opening…");
    expect(second.disabled).toBe(true);

    await act(async () => fail?.(new Error("session create timed out")));
    expect(screen.getByTestId("roster-talk-error").textContent).toBe("Could not open a conversation: session create timed out");
    expect(first.textContent).toBe("Talk");
    expect(first.disabled).toBe(false);
    expect(second.disabled).toBe(false);
  });
});
