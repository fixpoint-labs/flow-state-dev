// @vitest-environment happy-dom
/**
 * A coding task whose work is a pull request (its run's own, or the one
 * **Open a PR** opened) stays open until the pull request merges or closes
 * (harness-manager's `awaitPullRequests`). The popup must say so, *PR open ·
 * #7* with the link, and say how to wake it, or the task reads as a run still
 * working while it only waits on a merge. The coding board view reads the
 * wait off the row (`pullRequests`, by number), never as a hold on you.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PopupView, PULL_REQUEST_HINT } from "../src/components/Popups";
import { lookOf } from "../src/lib/looks";
import { codingTask, stubServer, TestProvider } from "./stub-server";

afterEach(cleanup);

const URL_7 = "https://github.com/acme/app/pull/7";

/** A coding row waiting on pull request 7, as the coding board view answers it: running, nothing asked of you. */
const waitingRow = codingTask({ id: "t-7", status: "in_progress", assignee: "coder.cursor", harness: "cursor", title: "Add a welcome line", run: { sessionId: "run-7", requestId: "r-1", attempt: 1 }, pullRequests: [7] });

function drawPopup(task = waitingRow) {
  const { client } = stubServer({ board: { s1: [task] }, recorded: { "run-7": { pullRequests: [{ number: 7, url: URL_7, title: "Add a welcome line" }] } } });
  render(
    <TestProvider client={client}>
      <PopupView popup={{ kind: "task", sessionId: "s1", taskId: task.id }} nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} isCoding={() => true} coders={[]} onClose={() => {}} />
    </TestProvider>,
  );
  return screen.findByRole("dialog");
}

describe("a coding task waiting on its pull request", () => {
  it("shows PR open · #7, linked from the run session's record, and how to wake it, and never as waiting on you", async () => {
    const popup = await drawPopup();
    // The header says it: PR open in the status, and #7 in the line under the title, linked once the run session's record is read.
    await waitFor(() => expect(within(popup).getByRole("link", { name: "#7" }).getAttribute("href")).toBe(URL_7));
    expect(popup.querySelector("[data-overlay-status]")?.textContent).toBe("PR open");
    expect(popup.querySelector("[data-review-meta] [data-meta-pull-request]")?.textContent).toBe("#7");
    // How to wake it: the compose at the foot asks.
    expect(within(popup).getByLabelText("Steer this task").getAttribute("placeholder")).toBe(PULL_REQUEST_HINT);
    expect(within(popup).queryByRole("region", { name: "Waiting on you" })).toBeNull();
    expect(popup.textContent).toContain("PR open");
  });

  it("shows none once the row settled", async () => {
    const popup = await drawPopup({ ...waitingRow, status: "completed", pullRequests: [] });
    await waitFor(() => expect(popup.textContent).toContain("finished without writing a result"));
    expect(popup.querySelector("[data-overlay-status]")?.textContent).not.toBe("PR open");
    expect(popup.querySelector("[data-meta-pull-request]")).toBeNull();
  });
});
