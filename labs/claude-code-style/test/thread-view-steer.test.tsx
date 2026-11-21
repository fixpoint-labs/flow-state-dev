// @vitest-environment happy-dom
/**
 * A coding thread's composer while its run works, before any review: the composer takes a steer, so
 * its Send is on. Readiness for review gates only the review's own accept, never the composer.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CodingBoardTask } from "../src/app";
import { codingBoardTask } from "./coding-board-task";
import { ThreadView } from "../src/components/ThreadView";
import { SessionOverlayArea, SessionOverlayProvider } from "../src/components/flow-state/session-overlay";
import { RUN, reviewStop, stubServer, underReview, verdictOf } from "./stub-server";

afterEach(cleanup);

const workingTask: CodingBoardTask = codingBoardTask({
  id: "t-1",
  title: "Add a CHANGELOG line",
  goal: "Add a line",
  status: "in_progress",
  harness: "claude-code",
  statusNote: "Editing CHANGELOG.md",
});

/** The steers the board took: each `updateTask` send with a message. */
const steersIn = (posts: ReturnType<typeof stubServer>["posts"]) =>
  posts.flatMap((posted) => (posted.path.endsWith("/actions/updateTask_tasks") && typeof (posted.body.input as { message?: unknown }).message === "string" ? [(posted.body.input as { message: string }).message] : []));

const reviewTask: CodingBoardTask = underReview(workingTask);

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
    const server = stubServer({ items: { [RUN.sessionId]: [reviewStop("stop-1", REVIEW)] } });
    // The board holds the task as the view draws it.
    const view = (task: CodingBoardTask) => {
      server.board["s-1"] = [task];
      return server.wrap(
        <SessionOverlayProvider>
          <SessionOverlayArea>
            <ThreadView sessionId="s-1" task={task} pinned={false} onClose={() => {}} />
          </SessionOverlayArea>
        </SessionOverlayProvider>,
      );
    };
    const { rerender } = render(view(reviewTask));
    fireEvent.click(await waitFor(() => within(screen.getByRole("dialog")).getByRole("button", { name: "Open a PR" })));
    await waitFor(() => expect(server.posts.map(verdictOf)).toContainEqual({ verdict: "accepted", land: "pull-request" }));
    // The landing opened a pull request: the task waits on it, with no review hold open.
    rerender(view({ ...workingTask, run: { ...RUN, attempt: 1 } }));
    fireEvent.change(screen.getByLabelText("Message this task"), { target: { value: "Merged, I checked." } });
    const send = within(screen.getByRole("dialog")).getByRole("button", { name: "Send" }) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(steersIn(server.posts)).toEqual(["Merged, I checked."]));
  });
});

describe("a coding thread's composer while it works", () => {
  it("sends a steer by the button before its review exists, as it does by Cmd+Enter", async () => {
    const server = stubServer();
    render(
      server.wrap(
        <SessionOverlayProvider>
          <SessionOverlayArea>
            <ThreadView sessionId="s-1" task={workingTask} pinned={false} onClose={() => {}} />
          </SessionOverlayArea>
        </SessionOverlayProvider>,
      ),
    );
    const box = screen.getByLabelText("Message this task");
    fireEvent.change(box, { target: { value: "Keep it to one line." } });
    const send = await waitFor(() => within(screen.getByRole("dialog")).getByRole("button", { name: "Send" }) as HTMLButtonElement);
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(steersIn(server.posts)).toEqual(["Keep it to one line."]));
    // No accept is offered while the run works.
    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
  });
});
