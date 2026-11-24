// @vitest-environment happy-dom
/**
 * Inbox groups what waits on the user by the worker that asked: every ask no
 * task holds is listed under its worker's group, with a count, so three
 * error reports read as one recognizable group, each still showing its title,
 * where it came from and how often it was seen. A task's item stays its own.
 *
 * `useView` is replaced by a stand-in that answers the inbox view.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inboxItems, taskActionName } from "@flow-state-dev/orchestration/inbox";
import { GAPS } from "../src/gaps";
import type { InboxAsk, InboxViewValue } from "../src/lib/inbox";
import { Inbox } from "../src/surfaces/Inbox";

let value: InboxViewValue = { items: [], tasks: [] };
vi.mock("@flow-state-dev/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/react")>()),
  useView: () => ({ value, stale: false, refresh: () => undefined }),
}));
vi.mock("../src/lib/lab-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/lab-data")>()),
  useLab: () => ({ client: {} }),
}));

// The ask's session and its reply box read feeds this test doesn't serve.
vi.mock("../src/lib/session-feeds", () => ({ useSharedSessionFeed: () => undefined, useRetrySessionFeed: () => () => undefined }));
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => ({}) }));
vi.mock("../src/lib/deliver", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/lib/deliver")>()), useDeliverLine: () => async () => undefined }));

afterEach(cleanup);

type Asked = { id: string; workerId: string; sessionId: string; title?: string; message: string; since: number };

/** The view's answer over `asked` and one task holding a question, built as the server builds it. */
function viewOf(asked: Asked[]): InboxViewValue {
  const task = {
    boardRef: "s_desk.tasks",
    ownerSessionId: "s_desk",
    id: "T1",
    title: "Tidy checkout",
    status: "in_progress",
    assignee: "eng.coder",
    holds: [{ id: "q1", actor: "user", openedAt: 2, source: { kind: "task" }, ask: { kind: "question", prompt: "Which branch?" } }],
  };
  return {
    tasks: [],
    items: inboxItems<InboxAsk>({
      rows: [{ ...task, board: task.boardRef, holder: { sessionId: task.ownerSessionId, action: taskActionName("updateTask", "tasks") } } as never],
      suspensions: asked.map((ask) => ({
        sessionId: ask.sessionId,
        flowId: "agent",
        requestId: `req_${ask.id}`,
        suspensionId: ask.id,
        kind: "input",
        prompt: ask.message,
        ...(ask.title === undefined ? {} : { title: ask.title }),
        since: ask.since,
        detail: { suspensionId: ask.id, requestId: `req_${ask.id}`, sessionId: ask.sessionId, workerId: ask.workerId, ...(ask.title === undefined ? {} : { title: ask.title }), message: ask.message, kind: "input", createdAt: ask.since } as unknown as InboxAsk,
      })),
      flowOf: () => "agent",
    }),
  };
}

const reports: Asked[] = [
  { id: "sp1", workerId: "error-reporter", sessionId: "error-report~fp-aaaa1111bbbb2222", title: "Error report: Checkout total wrong after coupon", message: "From a failed task (Tidy checkout) · seen 3 times. File it?", since: 1 },
  { id: "sp2", workerId: "error-reporter", sessionId: "error-report~fp-cccc3333dddd4444", title: "Error report: Board shows done for a task that never ran", message: "From a problem a user described · seen 1 time. File it?", since: 4 },
  { id: "sp3", workerId: "error-reporter", sessionId: "error-report~fp-eeee5555ffff6666", title: "Error report: Coordinator fails with no repository", message: "From a failed request (agent / respond) · seen 2 times. File it?", since: 6 },
];
const approval: Asked = { id: "sp4", workerId: "shift-coordinator", sessionId: "s_coord", title: "Fire eng.coder?", message: "It has been idle a week.", since: 3 };

const screenOf = (itemId: string | null) => <Inbox itemId={itemId} gaps={GAPS} />;

describe("an untitled ask in a worker's group", () => {
  // Its heading is already what it asks: the line under it would say it twice.
  it("shows what it asks once", () => {
    value = viewOf([{ id: "sp5", workerId: "eng.em", sessionId: "s_em", message: "Which branch should I cut the release from?", since: 1 }]);
    render(screenOf(null));
    const [item] = within(screen.getByTestId("inbox-group")).getAllByTestId("inbox-item");
    expect(within(item!).getByTestId("inbox-item-question").textContent).toBe("Which branch should I cut the release from?");
    expect(item!.textContent!.split("Which branch should I cut the release from?")).toHaveLength(2);
  });
});

describe("an Inbox with three error reports waiting", () => {
  it("shows them as one group under the worker that asked, with its count, each with its title, source and count", () => {
    value = viewOf([...reports, approval]);
    render(screenOf(null));
    const groups = screen.getAllByTestId("inbox-group");
    const reporter = groups.find((group) => group.getAttribute("data-worker") === "error-reporter")!;
    expect(within(reporter).getByTestId("inbox-group-head").textContent).toBe("error-reporter · 3 waiting");
    const items = within(reporter).getAllByTestId("inbox-item");
    expect(items.map((item) => within(item).getByTestId("inbox-item-question").textContent)).toEqual(reports.map((r) => r.title));
    expect(items.map((item) => within(item).getByTestId("inbox-item-from").textContent)).toEqual(reports.map((r) => r.message));

    // Every lone ask groups the same way, by its worker: one rule, no error-report special case.
    const coordinator = groups.find((group) => group.getAttribute("data-worker") === "shift-coordinator")!;
    expect(within(coordinator).getByTestId("inbox-group-head").textContent).toBe("Shift Coordinator · 1 waiting");
    // A task's item stays its own, named by its task, outside every group.
    const own = screen.getAllByTestId("inbox-item").filter((item) => item.closest("[data-testid=inbox-group]") === null);
    expect(own.map((item) => within(item).getByTestId("inbox-item-from").textContent)).toEqual(["eng.coder · task Tidy checkout"]);
  });

  it("opens a report's ask from a link naming its session, and any other session as it opens an unknown id: nothing picked", () => {
    value = viewOf(reports);
    const view = render(screenOf("error-report~fp-cccc3333dddd4444"));
    expect(screen.getByTestId("inbox-detail-title").textContent).toBe(reports[1]!.title);
    view.unmount();
    // Another user's report session: not among this user's asks.
    render(screenOf("error-report~fp-9999999999999999"));
    expect(screen.queryByTestId("inbox-detail-title")).toBeNull();
    expect(screen.getByTestId("inbox-detail").textContent).toContain("Pick an ask");
  });
});
