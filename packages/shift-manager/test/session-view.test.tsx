// @vitest-environment happy-dom
/**
 * <SessionView> draws one session by id, opened from Messages (FIX-1989).
 * What is checked: a task's session and a delegate's session for another conversation take no line whatever the
 * worker, a worker's own conversation does, and a session the page's list
 * doesn't hold yet is looked up in a fresh listing before it is called
 * missing. The read and the listing are stood in for.
 */
import { act, cleanup, render as draw, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import type { SessionSummary } from "@flow-state-dev/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAPS } from "../src/gaps";

const read = vi.fn();
const listSessions = vi.fn();
// One object, as the provider hands one: a fresh `client` each render would re-read forever.
const lab = {
  client: { userId: "u_1", sessions: { list: listSessions } },
  refresh: vi.fn(),
  snapshot: { orgId: "org_1", sessions: [], inventory: { ok: true, value: { workers: [] } } },
};
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));
/** What the page's directory holds: the session list and the inventory the case draws. */
let listed: unknown;
vi.mock("../src/lib/directory-reads", async () => {
  const { useFixedReads } = await import("./helpers/directory");
  return { useDirectoryReads: () => useFixedReads(() => listed as never) };
});
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => ({ organization: async () => "org_1", ensureWorkerSession: vi.fn() }) }));
// The conversation follows its session: its first answer is `read`'s.
vi.mock("../src/lib/session-feeds", async () => (await import("./helpers/fake-feed")).fakeFeeds([], (sessionId) => read(lab.client, sessionId)));

import { SessionView } from "../src/surfaces/SessionView";
import { DirectoryProvider } from "../src/lib/directory";

const render = (ui: ReactElement) => draw(ui, { wrapper: DirectoryProvider });

// A registered worker with a door: only the session decides whether a line may go.
const reviewer = { id: "eng.reviewer", kind: "agent", door: "talk", rules: false, team: "", name: "Reviewer" };
const session = (id: string, state: Record<string, unknown> = {}): SessionSummary =>
  ({ id, flowKind: "agent", flowId: "agent", state: { workerId: "eng.reviewer", ...state }, createdAt: 1, parentSessionId: null }) as unknown as SessionSummary;
const snapshot = (sessions: SessionSummary[]) =>
  ({ orgId: "org_1", sessions, inventory: { ok: true, value: { workers: [reviewer] } } }) as never;

beforeEach(() => {
  read.mockReset();
  listSessions.mockReset();
  read.mockResolvedValue({ items: [], truncated: false });
});
afterEach(() => cleanup());

async function drawn(sessions: SessionSummary[], sessionId: string) {
  listed = snapshot(sessions);
  render(<SessionView sessionId={sessionId} gaps={GAPS} />);
  await act(async () => {});
}

describe("a session opened by id", () => {
  it("takes no line in a task's session, even for a registered worker with a door", async () => {
    await drawn([session("s_task", { taskId: "t1", filingSessionId: "s_conv" })], "s_task");
    expect(screen.getByTestId("session-composer-blocked").textContent).toContain("task's session");
  });

  it("takes no line in a session answering messages routed from another conversation", async () => {
    await drawn([session("s_post", { filingSessionId: "s_conv" })], "s_post");
    expect(screen.getByTestId("session-composer-blocked").textContent).toContain("answers messages routed from another conversation");
  });

  it("takes a line in the worker's own conversation once it is read", async () => {
    await drawn([session("s_own")], "s_own");
    expect(screen.queryByTestId("session-composer-blocked")).toBeNull();
  });

  it("looks up a session the page's list doesn't hold, among dispatch runs too, before calling it missing", async () => {
    listSessions.mockResolvedValue([session("s_new")]);
    await drawn([], "s_new");
    expect(listSessions).toHaveBeenCalledWith({ userId: "u_1", include: "dispatch-runs" });
    expect(screen.getByTestId("session")).toBeTruthy();
    expect(read).toHaveBeenCalledWith(expect.anything(), "s_new");
  });

  it("says the session is missing when the fresh listing doesn't hold it either", async () => {
    listSessions.mockResolvedValue([]);
    await drawn([], "s_gone");
    expect(screen.getByTestId("session-missing")).toBeTruthy();
  });
});
