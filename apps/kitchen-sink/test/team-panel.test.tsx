// @vitest-environment happy-dom
/**
 * The workers panel's "Talk". Opening a conversation may create a session, so
 * a slow open holds every "Talk" until it settles: a double click, or a click
 * on a second worker, must not start a second create. Red state produced: with
 * the hold removed, the double-click case records two opens.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
  settings: {},
});

const workforce = { roster: async () => [worker("coordinator"), worker("billing")] } as unknown as WorkforceClient;

describe("the workers panel's Talk", () => {
  it("opens one conversation for a double click, holds every Talk while it opens, and says why when it can't", async () => {
    const opened: string[] = [];
    let fail: ((failure: Error) => void) | undefined;
    const onTalk = (entry: RosterEntry) => {
      opened.push(entry.id);
      return new Promise<void>((_, reject) => (fail = reject));
    };
    render(<TeamPanel workforce={workforce} onTalk={onTalk} />);
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
