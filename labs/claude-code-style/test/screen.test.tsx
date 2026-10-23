// @vitest-environment happy-dom
/**
 * The screen, on fixtures. These prove the UI only: the layout, the result
 * card inside a running turn, and that stopping goes through the main
 * session. The goal check proves the package at wiring.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { createFixtureLab } from "../src/fixtures";

// The script runs at a hundredth of real time.
const fast = () => createFixtureLab({ speed: 0.01 });

afterEach(cleanup);

async function ask(text: string) {
  const box = await screen.findByLabelText("Message the main session");
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

const thread = () => screen.getByRole("main", { name: "Main thread" });
const pane = () => screen.getByRole("complementary", { name: "Background tasks" });
const row = (title: string) => within(pane()).getByRole("button", { name: new RegExp(title) });

describe("the session-mode screen", () => {
  it("lays out sessions, the main thread and the tasks pane, and opens on a new session", async () => {
    render(<App adapter={fast()} />);
    const sessions = screen.getByRole("navigation", { name: "Sessions" });
    await waitFor(() => expect(within(sessions).getByRole("button", { current: true }).textContent).toMatch(/New session/));
    expect(within(sessions).getByText("Draft the launch note")).toBeTruthy();
    expect(within(thread()).getByText("Session")).toBeTruthy();
    expect(within(pane()).getByText(/Background tasks · 0/)).toBeTruthy();
  });

  it("offers threads mode on New session but keeps it disabled until it is built", async () => {
    render(<App adapter={fast()} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New session" }));
    const menu = screen.getByRole("menu");
    expect((within(menu).getByRole("menuitem", { name: /Session/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(menu).getByRole("menuitem", { name: /Threads/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a background result inside the running turn, then stops the other task when asked", async () => {
    render(<App adapter={fast()} />);
    await ask("Compare Acme and Globex for us.");

    // Steps 2 and 3: the main session writes, then two task rows appear.
    await waitFor(() => expect(within(pane()).getByText(/Background tasks · 2/)).toBeTruthy());
    expect(within(thread()).getByText(/write the outline myself/)).toBeTruthy();

    // Step 4: the card lands while the working indicator is still on, and the turn goes on to use it.
    const card = await within(thread()).findByRole("region", { name: "Background result: Research Acme" });
    expect(card.dataset.duringTurn).toBe("true");
    expect(within(thread()).getByRole("status").textContent).toMatch(/working/);
    await within(thread()).findByText(/Acme's research is in/);
    expect(row("Research Acme").dataset.taskStatus).toBe("completed");

    // The turn ends with Globex still running.
    await waitFor(() => expect(within(thread()).queryByRole("status")).toBeNull());
    expect(row("Research Globex").dataset.taskStatus).toBe("in_progress");

    // Step 5: stopping is asked of the main session, which cancels its own task.
    await ask("Stop the Globex research.");
    await waitFor(() => expect(row("Research Globex").dataset.taskStatus).toBe("cancelled"));
    expect(within(thread()).getByText(/updateTask · Research Globex → cancelled/)).toBeTruthy();
  });

  it("keeps the tasks pane read only: a row opens the task's work, with no stop or composer", async () => {
    render(<App adapter={fast()} />);
    await ask("Compare Acme and Globex for us.");
    await waitFor(() => expect(row("Research Globex")).toBeTruthy());
    fireEvent.click(row("Research Globex"));
    const work = within(pane()).getByRole("region", { name: "Work: Research Globex" });
    expect(within(work).getByText(/Starting:/)).toBeTruthy();
    expect(within(pane()).queryByRole("button", { name: /stop|cancel/i })).toBeNull();
    expect(within(pane()).queryByRole("textbox")).toBeNull();
  });

  it("queues a line sent while a turn runs, and runs it after", async () => {
    render(<App adapter={fast()} />);
    await ask("Compare Acme and Globex for us.");
    await within(thread()).findByRole("status");
    await ask("Also add a risks section.");
    expect(within(thread()).getByText(/queued · runs when this turn ends/)).toBeTruthy();
    await within(thread()).findByText(/Noted\./);
  });

  it("interrupts the running turn with Stop", async () => {
    render(<App adapter={fast()} />);
    await ask("Compare Acme and Globex for us.");
    await within(thread()).findByRole("status");
    fireEvent.click(within(thread()).getByRole("button", { name: "Stop" }));
    await within(thread()).findByText(/Interrupted/);
    expect(within(thread()).queryByRole("status")).toBeNull();
  });
});
