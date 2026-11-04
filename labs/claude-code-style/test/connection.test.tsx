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
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { createFakeLab } from "./fake-lab";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const thread = () => screen.getByRole("main", { name: "Main thread" });
const working = () => within(thread()).getByText(/working ·/).closest<HTMLElement>("[role=status]")!;

async function startTurn() {
  // Slow enough that the turn is still running while the test reads it.
  const lab = createFakeLab({ speed: 1 });
  render(<App adapter={lab} />);
  const picker = await screen.findByRole("region", { name: "Choose a project" });
  fireEvent.click(await within(picker).findByRole("button", { name: "vendor-notes" }));
  const box = await screen.findByLabelText("Message the main session");
  await act(async () => {
    fireEvent.change(box, { target: { value: "Compare Acme and Globex for us." } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
  await within(thread()).findByText(/working ·/);
  return lab;
}

describe("the server going away mid-turn", () => {
  it("shows the bar and greys the working line only once a retry has failed, and clears both when live again", async () => {
    const lab = await startTurn();

    act(() => lab.setConnection("reconnecting"));
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    expect(working().className).not.toContain("opacity-60");

    act(() => lab.setConnection("lapsed"));
    expect(screen.getByTestId("connection-banner").textContent).toContain("Lost the server");
    expect(working().className).toContain("opacity-60");

    act(() => lab.setConnection("live"));
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    expect(working().className).not.toContain("opacity-60");
  });

  it("stops the turn's clock while the feed is stale", async () => {
    const lab = await startTurn();
    act(() => lab.setConnection("lapsed"));
    const held = working().textContent;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 2_100)));
    expect(working().textContent).toBe(held);
  });
});
