// @vitest-environment happy-dom
/**
 * When the lab's server goes away mid-turn. Without the bar the thread looks
 * alive: the dot keeps pulsing and "working · 3m" keeps counting, and the
 * only sign is a line in the console. So a thread whose feed has failed a
 * retry draws the bar, greys the working line and stops its clock where the
 * data stopped. A feed's ordinary reconnect, which the first retry fixes,
 * draws nothing: a bar that flashes on every routine close teaches people to
 * ignore it.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/components/App";
import { closeApps, openTestApp, waitFor as wait, type TestApp } from "./app-host";

afterEach(async () => {
  cleanup();
  window.history.replaceState(null, "", "/");
  await closeApps();
});

const thread = () => screen.getByRole("main", { name: "Main thread" });
const working = () => within(thread()).getByText(/working ·/).closest<HTMLElement>("[role=status]")!;

/** A turn that runs until it is stopped, so the test reads it while it is still running. */
async function startTurn(): Promise<TestApp> {
  const lab = await openTestApp({
    scripts: {
      "agent-answer": async ({ signal }) => {
        await wait(60_000, signal);
        return { text: "Done." };
      },
    },
  });
  render(lab.wrap(<App />));
  const picker = await screen.findByRole("region", { name: "Choose a project" });
  fireEvent.click(await within(picker).findByRole("button", { name: "vendor-notes" }));
  const box = await screen.findByLabelText("Message the main session", undefined, { timeout: 10_000 });
  await act(async () => {
    fireEvent.change(box, { target: { value: "Compare Acme and Globex for us." } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
  await within(thread()).findByText(/working ·/, undefined, { timeout: 10_000 });
  return lab;
}

describe("the server going away mid-turn", () => {
  it("shows the bar and greys the working line once a retry has failed, and clears both when the server is back", async () => {
    const lab = await startTurn();
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    expect(working().className).not.toContain("opacity-60");

    // The host stops answering: the feed's first retry fails, and only then does the bar show.
    lab.pull();
    await waitFor(() => expect(screen.getByTestId("connection-banner").textContent).toContain("Lost the server"), { timeout: 15_000 });
    expect(working().className).toContain("opacity-60");

    lab.restore();
    await waitFor(() => expect(screen.queryByTestId("connection-banner")).toBeNull(), { timeout: 40_000 });
    expect(working().className).not.toContain("opacity-60");
  }, 60_000);

  it("stops the turn's clock while the feed is stale", async () => {
    const lab = await startTurn();
    lab.pull();
    await waitFor(() => expect(screen.getByTestId("connection-banner")).toBeTruthy(), { timeout: 15_000 });
    const held = working().textContent;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 2_100)));
    expect(working().textContent).toBe(held);
  }, 30_000);
});
