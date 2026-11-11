// @vitest-environment happy-dom
/**
 * A coding thread's composer while its run works, before any review: the composer takes a steer, so
 * its Send is on. Readiness for review gates only the review's own accept, never the composer.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LabAdapter, LabTask } from "../src/adapter";
import { ThreadView } from "../src/components/ThreadView";
import { SessionOverlayArea, SessionOverlayProvider } from "../src/components/flow-state/session-overlay";

afterEach(cleanup);

const workingTask: LabTask = {
  id: "t-1",
  title: "Add a CHANGELOG line",
  goal: "Add a line",
  status: "in_progress",
  harness: "claude-code",
  statusNote: "Editing CHANGELOG.md",
} as LabTask;

function stub() {
  const sayInThread = vi.fn(async (_s: string, _t: string, _line: string) => {});
  const adapter = {
    watchTaskWork: (_s: string, _t: string, onChange: (work: unknown) => void) => {
      onChange({ entries: [] });
      return () => {};
    },
    taskActions: () => ({ cancel: async () => [], steer: async () => {}, release: async () => {}, retry: async () => {} }),
    sayInThread,
  };
  return { adapter: adapter as unknown as LabAdapter, sayInThread };
}

const reviewTask: LabTask = {
  ...workingTask,
  status: "in_progress",
  openHold: { kind: "review", prompt: "Accept the changes, or ask for changes in words." },
} as LabTask;

const REVIEW = {
  branch: "conductor/t0/ha62-h01/t-1--code",
  commits: 1,
  subjects: ["docs: note the vendor pick"],
  judge: null,
  checks: null,
  lands: ["pull-request", "merge"],
} as const;

describe("a coding thread's composer after it accepts a review", () => {
  it("frees the composer once a landing moves the task on to its pull request, so you can say a merge", async () => {
    const resolve = vi.fn(async (_s: string, _t: string, _land?: string) => {});
    const sayInThread = vi.fn(async (_s: string, _t: string, _line: string) => {});
    const adapter = {
      watchTaskWork: (_s: string, _t: string, onChange: (work: unknown) => void) => {
        onChange({ entries: [], review: REVIEW, reviewStop: "stop-1" });
        return () => {};
      },
      taskActions: () => ({ cancel: async () => [], steer: async () => {}, release: async () => {}, retry: async () => {} }),
      resolve,
      sayInThread,
    } as unknown as LabAdapter;
    const view = (task: LabTask) => (
      <SessionOverlayProvider>
        <SessionOverlayArea>
          <ThreadView adapter={adapter} sessionId="s-1" task={task} pinned={false} onClose={() => {}} />
        </SessionOverlayArea>
      </SessionOverlayProvider>
    );
    const { rerender } = render(view(reviewTask));
    fireEvent.click(await waitFor(() => within(screen.getByRole("dialog")).getByRole("button", { name: "Open a PR" })));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith("s-1", "t-1", "pull-request"));
    // The landing opened a pull request: the task waits on it, with no review hold open.
    rerender(view({ ...workingTask, openHold: undefined }));
    fireEvent.change(screen.getByLabelText("Message this task"), { target: { value: "Merged, I checked." } });
    const send = within(screen.getByRole("dialog")).getByRole("button", { name: "Send" }) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(sayInThread).toHaveBeenCalledWith("s-1", "t-1", "Merged, I checked."));
  });
});

describe("a coding thread's composer while it works", () => {
  it("sends a steer by the button before its review exists, as it does by Cmd+Enter", async () => {
    const { adapter, sayInThread } = stub();
    render(
      <SessionOverlayProvider>
        <SessionOverlayArea>
          <ThreadView adapter={adapter} sessionId="s-1" task={workingTask} pinned={false} onClose={() => {}} />
        </SessionOverlayArea>
      </SessionOverlayProvider>,
    );
    const box = screen.getByLabelText("Message this task");
    fireEvent.change(box, { target: { value: "Keep it to one line." } });
    const send = await waitFor(() => within(screen.getByRole("dialog")).getByRole("button", { name: "Send" }) as HTMLButtonElement);
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(sayInThread).toHaveBeenCalledWith("s-1", "t-1", "Keep it to one line."));
    // No accept is offered while the run works.
    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
  });
});
