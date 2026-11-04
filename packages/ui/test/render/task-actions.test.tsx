// @vitest-environment happy-dom
/**
 * A person stops, steers, releases, retries and re-runs a task from the task
 * itself, and sees what the board did, or its refusal, in place. So the row
 * draws the buttons the board status allows and no others, asks once before a
 * cancel (it ends a run and the tasks waiting on it), names the tasks a
 * cancel took, holds a button busy while its call runs, and shows the
 * board's own words when it refuses, never a guess of its own.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANCEL_CONFIRM, TaskActions, type TaskActionCalls } from "../../registry/components/task-actions";

afterEach(cleanup);

/** Calls that each record what they were sent and resolve as the board would. */
function calls(overrides: Partial<TaskActionCalls> = {}): TaskActionCalls & { [K in keyof TaskActionCalls]: ReturnType<typeof vi.fn> } {
  return {
    cancel: vi.fn(async () => []),
    steer: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    ...overrides,
  } as never;
}

/** The test ids of the buttons drawn, in order. */
const buttons = () => screen.queryAllByRole("button").map((b) => b.getAttribute("data-testid"));

/** A promise this test settles by hand, to hold a call in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("the buttons follow the board status", () => {
  it("an open task offers Cancel; a held one Release too; the Steer box only when asked for", () => {
    const { rerender } = render(<TaskActions id="t1" status="pending" actions={calls()} />);
    expect(buttons()).toEqual(["task-action-cancel"]);
    rerender(<TaskActions id="t1" status="in_progress" actions={calls()} />);
    expect(buttons()).toEqual(["task-action-cancel"]);
    rerender(<TaskActions id="t1" status="held" actions={calls()} />);
    expect(buttons()).toEqual(["task-action-cancel", "task-action-release"]);
    rerender(<TaskActions id="t1" status="in_progress" actions={calls()} steer />);
    expect(buttons()).toEqual(["task-action-cancel", "task-action-steer"]);
    expect(screen.getByTestId("task-action-steer-input")).toBeTruthy();
  });

  it("a failed or cancelled task offers Retry and one Re-run per option, and no Cancel or Steer", () => {
    const rerun = [
      { label: "Claude Code", run: async () => "t9" },
      { label: "Codex", run: async () => "t10" },
    ];
    const { rerender } = render(<TaskActions id="t1" status="errored" actions={calls()} steer rerun={rerun} />);
    expect(buttons()).toEqual(["task-action-retry", "task-action-rerun", "task-action-rerun"]);
    expect(screen.getAllByTestId("task-action-rerun").map((b) => b.textContent)).toEqual(["Re-run on Claude Code", "Re-run on Codex"]);
    expect(screen.queryByTestId("task-action-steer-input")).toBeNull();
    rerender(<TaskActions id="t1" status="cancelled" actions={calls()} />);
    expect(buttons()).toEqual(["task-action-retry"]);
  });

  it("a completed task, or a status it doesn't know, draws nothing", () => {
    expect(render(<TaskActions id="t1" status="completed" actions={calls()} rerun={[{ label: "Codex", run: async () => "t" }]} />).container.innerHTML).toBe("");
    cleanup();
    expect(render(<TaskActions id="t1" status="paused" actions={calls()} />).container.innerHTML).toBe("");
  });
});

describe("Cancel asks once", () => {
  it("swaps the button for the confirm; No cancels nothing; Yes cancels this task", async () => {
    const actions = calls();
    render(<TaskActions id="t1" status="in_progress" actions={actions} />);
    fireEvent.click(screen.getByTestId("task-action-cancel"));
    expect(screen.getByTestId("task-action-confirm").textContent).toContain(CANCEL_CONFIRM);
    expect(screen.queryByTestId("task-action-cancel")).toBeNull();
    fireEvent.click(screen.getByTestId("task-action-confirm-no"));
    expect(actions.cancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("task-action-cancel")).toBeTruthy();

    fireEvent.click(screen.getByTestId("task-action-cancel"));
    fireEvent.click(screen.getByTestId("task-action-confirm-yes"));
    await waitFor(() => expect(screen.getByTestId("task-action-outcome").textContent).toBe("Cancelled."));
    expect(actions.cancel).toHaveBeenCalledExactlyOnceWith("t1");
  });

  it("names the waiting tasks the board cancelled with it", async () => {
    render(<TaskActions id="t1" status="pending" actions={calls({ cancel: vi.fn(async () => ["t2", "t3"]) })} />);
    fireEvent.click(screen.getByTestId("task-action-cancel"));
    fireEvent.click(screen.getByTestId("task-action-confirm-yes"));
    const outcome = await screen.findByTestId("task-action-outcome");
    expect(outcome.textContent).toContain("t2, t3");
  });
});

describe("each press", () => {
  it("holds every button busy while its call runs, then shows the outcome and lets the app read the row again", async () => {
    const release = deferred<void>();
    const onSettled = vi.fn();
    render(<TaskActions id="t1" status="held" actions={calls({ release: vi.fn(() => release.promise) })} onSettled={onSettled} />);
    fireEvent.click(screen.getByTestId("task-action-release"));
    await waitFor(() => expect((screen.getByTestId("task-action-release") as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByTestId("task-action-cancel") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("task-action-row").getAttribute("aria-busy")).toBe("true");
    expect(onSettled).not.toHaveBeenCalled();
    release.resolve();
    await waitFor(() => expect(screen.getByTestId("task-action-outcome").textContent).toBe("Released."));
    expect((screen.getByTestId("task-action-release") as HTMLButtonElement).disabled).toBe(false);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("shows the board's own words when it refuses, and no outcome", async () => {
    const onSettled = vi.fn();
    const refusal = 'Task "t1" is already open, so it can\'t be filed again (already_open).';
    render(
      <TaskActions id="t1" status="errored" actions={calls()} rerun={[{ label: "Codex", run: () => Promise.reject(new Error(refusal)) }]} onSettled={onSettled} />,
    );
    fireEvent.click(screen.getByTestId("task-action-rerun"));
    expect((await screen.findByTestId("task-action-refusal")).textContent).toBe(refusal);
    expect(screen.queryByTestId("task-action-outcome")).toBeNull();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("sends a steer's words, trimmed, and clears the box once the board took them", async () => {
    const actions = calls();
    render(<TaskActions id="t1" status="in_progress" actions={actions} steer />);
    const input = screen.getByTestId("task-action-steer-input") as HTMLInputElement;
    expect((screen.getByTestId("task-action-steer") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "  use the v2 endpoint " } });
    fireEvent.click(screen.getByTestId("task-action-steer"));
    await screen.findByTestId("task-action-outcome");
    expect(actions.steer).toHaveBeenCalledExactlyOnceWith("t1", "use the v2 endpoint");
    expect(input.value).toBe("");
  });

  it("retries this task by its id", async () => {
    const actions = calls();
    render(<TaskActions id="t1" status="cancelled" actions={actions} />);
    fireEvent.click(screen.getByTestId("task-action-retry"));
    await screen.findByTestId("task-action-outcome");
    expect(actions.retry).toHaveBeenCalledExactlyOnceWith("t1");
  });
});
