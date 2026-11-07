// @vitest-environment happy-dom
/**
 * A review verdict you give in a task's popup is written into its feed, after
 * the steps it was given over. That line belongs to the task and run it was
 * given on: the popup stays mounted when Back or Forward moves it to another
 * task in the same conversation, and a run's steps can be read again shorter
 * than they were. Neither may show a verdict on the wrong task, or draw a
 * step twice.
 */
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BoardTask, LabAdapter, SessionStep } from "../src/adapter";
import { PopupView, type Popup } from "../src/components/Popups";
import { lookOf } from "../src/lib/looks";

afterEach(cleanup);

const SESSION = "wks_cos";
const said = (n: number): SessionStep => ({ id: `s${n}`, kind: "said", text: `step ${n}` });
const steps = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => said(from + i));
const task = (id: string, waiting?: "review"): BoardTask => ({
  id,
  to: "coder.cursor",
  title: `Task ${id}`,
  goal: `Do ${id}.`,
  status: "running",
  boardStatus: "in_progress",
  runSessionId: `run_${id}`,
  ...(waiting ? { waiting: { kind: waiting, prompt: "Review the change.", unanswerable: null } } : {}),
});

/** One conversation's rows and each run's steps, which the test changes as a board and a run would. */
function liveAdapter(initial: { tasks: BoardTask[]; runs: Record<string, SessionStep[]> }) {
  let tasks = initial.tasks;
  const runs = { ...initial.runs };
  const onTasks = new Set<(tasks: BoardTask[]) => void>();
  const onRun = new Map<string, Set<(steps: SessionStep[]) => void>>();
  const adapter = {
    watchTasks: (_id: string, onChange: (tasks: BoardTask[]) => void) => {
      onTasks.add(onChange);
      onChange(tasks);
      return () => onTasks.delete(onChange);
    },
    watchRun: (run: string, onChange: (steps: SessionStep[]) => void) => {
      const set = onRun.get(run) ?? new Set();
      onRun.set(run, set.add(onChange));
      onChange(runs[run] ?? []);
      return () => set.delete(onChange);
    },
    watchReview: (_run: string, onChange: (review: undefined) => void) => (onChange(undefined), () => {}),
    // A running task's feed ends in its working line: nothing in flight here.
    watchWorking: (_run: unknown, onChange: (now: object) => void) => (onChange({}), () => {}),
    answerOpenHold: async () => {},
    taskActions: () => ({}),
  } as unknown as LabAdapter;
  return {
    adapter,
    setTasks: (next: BoardTask[]) => act(() => ((tasks = next), onTasks.forEach((f) => f(next)))),
    setRun: (run: string, next: SessionStep[]) => act(() => ((runs[run] = next), onRun.get(run)?.forEach((f) => f(next)))),
  };
}

const view = (adapter: LabAdapter, taskId: string) => {
  const popup: Popup = { kind: "task", sessionId: SESSION, taskId };
  return (
    <PopupView adapter={adapter} popup={popup} nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} isCoding={() => true} coders={[]} onClose={() => {}} />
  );
};

const decisions = (popup: HTMLElement) => [...popup.querySelectorAll('[data-step="decision"]')].map((d) => d.textContent);

async function accept(popup: HTMLElement) {
  const card = await within(popup).findByRole("region", { name: "Ready for review" });
  fireEvent.click(within(card).getByRole("button", { name: "Accept" }));
  await waitFor(() => expect(decisions(popup)).toContain("Accepted"));
}

describe("a verdict's line in a task popup's feed", () => {
  it("stays with its task: Back to another task in the same conversation shows none of it", async () => {
    const lab = liveAdapter({ tasks: [task("t1", "review"), task("t2")], runs: { run_t1: steps(1, 3), run_t2: steps(1, 2) } });
    const { rerender, getByRole } = render(view(lab.adapter, "t1"));
    await accept(getByRole("dialog"));

    rerender(view(lab.adapter, "t2"));
    const popup = getByRole("dialog", { name: "Coding task: Task t2" });
    expect(decisions(popup)).toEqual([]);
  });

  it("never draws a step twice when the run's steps are read again shorter", async () => {
    const lab = liveAdapter({ tasks: [task("t1", "review")], runs: { run_t1: steps(1, 10) } });
    const { getByRole } = render(view(lab.adapter, "t1"));
    const popup = getByRole("dialog");
    await accept(popup);

    // The same run's steps, read again shorter; then it waits on a second review, which you accept too.
    lab.setTasks([task("t1")]);
    lab.setRun("run_t1", steps(1, 3));
    lab.setTasks([task("t1", "review")]);
    await accept(popup);
    await waitFor(() => expect(decisions(popup)).toEqual(["Accepted", "Accepted"]));
    lab.setRun("run_t1", steps(1, 10));

    const drawn = [...popup.querySelectorAll('[data-step="said"]')].map((s) => s.textContent);
    expect(drawn).toEqual(steps(1, 10).map((s) => s.text));
  });
});
