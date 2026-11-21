// @vitest-environment happy-dom
/**
 * A review verdict you give in a task's popup is written into its feed, after
 * the steps it was given over. That line belongs to the task and run it was
 * given on: the popup stays mounted when Back or Forward moves it to another
 * task in the same conversation, and a run's steps can be read again shorter
 * than they were. Neither may show a verdict on the wrong task, or draw a
 * step twice.
 */
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { placeDecisions, PopupView, type Popup } from "../src/components/Popups";
import { lookOf } from "../src/lib/looks";
import { codingTask, hold, stubServer, TestProvider } from "./stub-server";

afterEach(cleanup);

const SESSION = "wks_cos";
/** A run session's items: what its run said, `count` lines of it. */
const said = (run: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `${run}-${i + 1}`, type: "message", role: "assistant", status: "completed", requestId: `q_${run}`, content: [{ type: "output_text", text: `step ${i + 1}` }] }));
const task = (id: string, review = false) =>
  codingTask({
    id,
    assignee: "coder.cursor",
    title: `Task ${id}`,
    status: "in_progress",
    run: { sessionId: `run_${id}`, requestId: `q_run_${id}`, attempt: 1 },
    ...(review ? { asks: [hold("review", "Review the change.", { taskId: id })] } : {}),
  });

const view = (client: Parameters<typeof TestProvider>[0]["client"], taskId: string) => {
  const popup: Popup = { kind: "task", sessionId: SESSION, taskId };
  return (
    <TestProvider client={client}>
      <PopupView popup={popup} nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} isCoding={() => true} coders={[]} onClose={() => {}} />
    </TestProvider>
  );
};

const decisions = (popup: HTMLElement) => [...popup.querySelectorAll('[data-step="decision"]')].map((d) => d.textContent);

describe("a verdict's line in a task popup's feed", () => {
  it("stays with its task: Back to another task in the same conversation shows none of it", async () => {
    const { client } = stubServer({ board: { [SESSION]: [task("t1", true), task("t2")] }, items: { run_t1: said("run_t1", 3), run_t2: said("run_t2", 2) } });
    const { rerender, getByRole } = render(view(client, "t1"));
    const popup = getByRole("dialog");
    const card = await within(popup).findByRole("region", { name: "Ready for review" });
    fireEvent.click(within(card).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(decisions(popup)).toContain("Accepted"));

    rerender(view(client, "t2"));
    const moved = await waitFor(() => getByRole("dialog", { name: "Coding task: Task t2" }));
    expect(decisions(moved)).toEqual([]);
  });

  it("never draws a step twice when the run's steps are read again shorter", () => {
    const given = [
      { id: "d0", run: "t1:run_t1", after: 10, text: "Accepted" },
      { id: "d1", run: "t1:run_t1", after: 3, text: "Accepted" },
    ];
    // Read again shorter: each verdict sits no later than the steps there are, and never before the one before it.
    expect(placeDecisions(given, 3).map((d) => d.after)).toEqual([3, 3]);
    // Read whole again: the first goes back to where it was given, and the second stays after it.
    expect(placeDecisions(given, 10).map((d) => d.after)).toEqual([10, 10]);
  });
});
