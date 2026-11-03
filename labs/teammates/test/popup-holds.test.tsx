// @vitest-environment happy-dom
/**
 * A coding task's popup is where you answer what its run waits on you for.
 * A run that asks shows its question with a box; your answer lets it go on.
 * A run that committed shows *Ready for review* with its commits and the
 * judge's verdict: **Ask for changes** sends your words back for one more
 * run, which you review again, and **Accept** completes the task. Without
 * these the task waits on you with nothing on screen to answer it.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { createFixtureLab } from "./fake-lab";

const fast = (options = {}) => createFixtureLab({ speed: 0.05, ...options });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const conversation = () => screen.getByRole("main", { name: "Conversation" });
const TASK = "Coding task: Fix the typo in the README's first line";

async function fileCodingTask() {
  const box = await screen.findByLabelText("Message Chief of Staff");
  await act(async () => {
    fireEvent.change(box, { target: { value: "Fix the typo in the README's first line." } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
  fireEvent.click(await within(conversation()).findByRole("button", { name: `${TASK}, on Cursor` }));
  return screen.findByRole("dialog", { name: TASK });
}

describe("a coding task's popup answers what its run waits on you for", () => {
  it("answers the run's question, then reviews its commits: Ask for changes runs it again, Accept completes it", async () => {
    render(<App adapter={fast({ asks: true, review: true })} />);
    const popup = await fileCodingTask();

    const asked = await within(popup).findByRole("region", { name: "Waiting on you" }, { timeout: 2000 });
    expect(asked.textContent).toMatch(/Should I fix only line 1, or every typo\?/);
    fireEvent.change(within(asked).getByLabelText("Your answer"), { target: { value: "Only line 1." } });
    fireEvent.click(within(asked).getByRole("button", { name: "Answer" }));
    await waitFor(() => expect(within(popup).queryByRole("region", { name: "Waiting on you" })).toBeNull());

    const review = await within(popup).findByRole("region", { name: "Ready for review" }, { timeout: 3000 });
    await waitFor(() => expect(review.textContent).toMatch(/1 commit(?!s)/));
    expect(review.textContent).toMatch(/Judge: done, 0\.91/);
    expect(within(popup).queryByRole("region", { name: "Result" })).toBeNull();

    fireEvent.change(within(review).getByLabelText("What to change"), { target: { value: "Keep the old wording." } });
    fireEvent.click(within(review).getByRole("button", { name: "Ask for changes" }));
    // One more run, reviewed again over both commits.
    await waitFor(() => expect(within(popup).getByRole("region", { name: "Ready for review" }).textContent).toMatch(/2 commits/), { timeout: 3000 });
    expect(popup.textContent).toMatch(/Revising: Keep the old wording\./);

    fireEvent.click(within(within(popup).getByRole("region", { name: "Ready for review" })).getByRole("button", { name: "Accept" }));
    expect(await within(popup).findByRole("region", { name: "Result" }, { timeout: 2000 })).toBeTruthy();
    await waitFor(() => expect(within(popup).queryByRole("region", { name: "Ready for review" })).toBeNull());
  });

  it("control: a run with nothing to ask and no review shows no box and no card, and completes on its own", async () => {
    render(<App adapter={fast()} />);
    const popup = await fileCodingTask();
    expect(await within(popup).findByRole("region", { name: "Result" }, { timeout: 3000 })).toBeTruthy();
    expect(within(popup).queryByRole("region", { name: "Waiting on you" })).toBeNull();
    expect(within(popup).queryByRole("region", { name: "Ready for review" })).toBeNull();
  });
});
