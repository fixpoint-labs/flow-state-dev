// @vitest-environment happy-dom
/**
 * The list follows the roster: a teammate hired or fired somewhere else (another
 * tab, or a worker's turn) shows without a reload, and the page never reads the
 * roster again on its own for a hire or fire made here. The adapter's watch is
 * the one source.
 *
 * Red state produced: against the boot read plus a re-read after this tab's
 * own hire and fire, the hire made elsewhere never shows.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { createFixtureLab } from "./fake-lab";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const listed = () =>
  [...screen.getByRole("navigation", { name: "Workers" }).querySelectorAll<HTMLElement>("[data-worker]")].map((row) => row.getAttribute("data-worker"));

describe("the worker list follows the roster", () => {
  it("shows a teammate hired elsewhere, and drops it when it is fired elsewhere", async () => {
    const lab = createFixtureLab({ speed: 0.05 });
    render(<App adapter={lab} />);
    await screen.findByLabelText("Message Chief of Staff");
    expect(listed()).not.toContain("scribe");

    // Another tab's hire: the adapter, not this page, makes it.
    await act(async () => void (await lab.hire({ name: "scribe", role: "Takes notes", instructions: "" })));
    await waitFor(() => expect(listed()).toContain("scribe"));

    await act(async () => void (await lab.fire("scribe")));
    await waitFor(() => expect(listed()).not.toContain("scribe"));
  });

  it("watches the roster once, whatever this tab hires", async () => {
    const lab = createFixtureLab({ speed: 0.05 });
    let watches = 0;
    const counted: typeof lab = {
      ...lab,
      watchWorkers: (onChange, onError) => {
        watches += 1;
        return lab.watchWorkers(onChange, onError);
      },
    };
    render(<App adapter={counted} />);
    await screen.findByLabelText("Message Chief of Staff");
    await act(async () => void (await lab.hire({ name: "scribe", role: "Takes notes", instructions: "" })));
    await waitFor(() => expect(listed()).toContain("scribe"));
    expect(watches).toBe(1);
  });
});
