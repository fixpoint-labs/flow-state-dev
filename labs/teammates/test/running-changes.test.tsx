// @vitest-environment happy-dom
/**
 * While a coding task works, its popup keeps what the run has changed so far
 * one click away: a quiet collapsed row ("5 files changed (+117 −9) · 2
 * commits") that opens to the same Files list and commits the review shows,
 * read live from the run's checkout (working tree included) through
 * harness-manager's run changes view. A file still opens to its diff.
 *
 * Red states this guards: a running task with no way to see its changes; a
 * row that reads the stored review instead of the checkout; a row drawn
 * before there is a checkout to read (it would claim "no changes"); a diff
 * read that leaves out the working tree; an open Files list that closes when
 * the run stops for review.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, type ClientFetch } from "@flow-state-dev/client";
import { CODER_FLOW, type ReviewDetail } from "@flow-state-dev/harness-manager/browser";
import { AppProvider } from "../src/app";
import { RunningChanges } from "../src/components/RunningChanges";
import { ReviewBody } from "../src/components/TaskReview";
import { codingTask } from "./stub-server";

afterEach(cleanup);

const task = codingTask({ id: "t1", title: "Fix it", status: "in_progress", harness: "claude-code", run: { sessionId: "run1", requestId: "q1", attempt: 1 }, runFlow: CODER_FLOW });

const FILES = [
  { path: "labs/teammates/host.mts", added: 100, removed: 7 },
  { path: "src/wip.ts", added: 17, removed: 2, uncommitted: true },
];
const DIFF = { files: FILES, fileCount: 5, added: 117, removed: 9, verified: true };
const COMMITS = { count: 2, subjects: ["feat: second", "feat: first"], verified: true };

/** A host whose run changes view answers `listed` without a path and a patch with one; every view call is kept. */
function host(listed: { status?: number; output?: unknown }) {
  const calls: Array<{ url: string; input: Record<string, unknown> }> = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://x").pathname;
    if (!path.endsWith("/views/changes")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    const input = (JSON.parse(String(init?.body)) as { input: Record<string, unknown> }).input;
    calls.push({ url: path, input });
    if (input.path !== undefined) {
      const output = { taskId: "t1", diff: null, commits: null, patch: { path: input.path, patch: "@@ -0,0 +1 @@\n+work in progress", truncated: false, lines: 2, verified: true } };
      return new Response(JSON.stringify({ output, topics: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (listed.status !== undefined) return new Response(JSON.stringify({ message: "refused" }), { status: listed.status, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ output: listed.output, topics: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as ClientFetch;
  const client = createClient({ userId: "u", baseUrl: "", fetcher });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(AppProvider, { client, pollIntervalMs: 100 }, children);
  return { calls, wrapper };
}

function Harness({ open: initial = false }: { open?: boolean }) {
  // The popup owns the open state, so it outlives the row's re-renders; here a plain toggle stands in.
  let open = initial;
  return <RunningChanges task={task} open={open} onOpenChange={(next) => (open = next)} />;
}

describe("a running task's changes so far", () => {
  it("shows one collapsed row with the files, lines and commits, read live with the working tree", async () => {
    const h = host({ output: { taskId: "t1", diff: DIFF, commits: COMMITS, patch: null } });
    render(<Harness />, { wrapper: h.wrapper });
    const toggle = await screen.findByRole("button", { name: /Changes so far/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("5 files changed");
    expect(toggle.textContent).toContain("+117");
    expect(toggle.textContent).toContain("−9");
    expect(toggle.textContent).toContain("2 commits");
    expect(screen.queryByText("labs/teammates/host.mts")).toBeNull();
    expect(h.calls[0]).toEqual({ url: `/api/flows/${CODER_FLOW}/run1/views/changes`, input: { taskId: "t1", uncommitted: true } });
  });

  it("opens to the files and commits, and a file still opens to its diff", async () => {
    const h = host({ output: { taskId: "t1", diff: DIFF, commits: COMMITS, patch: null } });
    render(<RunningChanges task={task} open onOpenChange={() => {}} />, { wrapper: h.wrapper });
    expect(await screen.findByText("labs/teammates/host.mts")).toBeTruthy();
    expect(screen.getByText("uncommitted")).toBeTruthy();
    expect(screen.getByText("and 3 more files")).toBeTruthy();
    // The commits, as the timeline draws them: the type a chip, the subject after it.
    expect(document.querySelector("[data-commit-timeline]")?.textContent).toContain("second");
    fireEvent.click(screen.getByRole("button", { name: /src\/wip\.ts/ }));
    expect(await screen.findByText("+work in progress")).toBeTruthy();
    // The working tree's diff of that file, from the same run session.
    expect(h.calls).toContainEqual({ url: `/api/flows/${CODER_FLOW}/run1/views/changes`, input: { taskId: "t1", path: "src/wip.ts", uncommitted: true } });
  });

  it("asks the parent to open and close it", async () => {
    const h = host({ output: { taskId: "t1", diff: DIFF, commits: COMMITS, patch: null } });
    const seen: boolean[] = [];
    render(<RunningChanges task={task} open={false} onOpenChange={(next) => seen.push(next)} />, { wrapper: h.wrapper });
    fireEvent.click(await screen.findByRole("button", { name: /Changes so far/ }));
    expect(seen).toEqual([true]);
  });

  it("says no changes yet for a run with a checkout that hasn't changed anything", async () => {
    const h = host({ output: { taskId: "t1", diff: { files: [], fileCount: 0, added: 0, removed: 0, verified: true }, commits: { count: 0, subjects: [], verified: true }, patch: null } });
    render(<Harness />, { wrapper: h.wrapper });
    expect(await screen.findByText("No changes yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Changes so far/ })).toBeNull();
  });

  it("draws nothing before the run has a checkout, or when the view refuses", async () => {
    const none = host({ output: { taskId: "t1", diff: { files: [], fileCount: 0, added: 0, removed: 0, verified: false }, commits: { count: 0, subjects: [], verified: false }, patch: null } });
    const { container } = render(<Harness />, { wrapper: none.wrapper });
    await waitFor(() => expect(none.calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
    cleanup();
    const refused = host({ status: 422 });
    const second = render(<Harness />, { wrapper: refused.wrapper });
    await waitFor(() => expect(refused.calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(second.container.textContent).toBe("");
  });

  it("draws nothing for a task that hasn't started a run", () => {
    const h = host({ output: { taskId: "t1", diff: DIFF, commits: COMMITS, patch: null } });
    const queued = codingTask({ id: "t2", title: "Later", status: "pending", harness: "claude-code", runFlow: CODER_FLOW });
    const { container } = render(<RunningChanges task={queued} open={false} onOpenChange={() => {}} />, { wrapper: h.wrapper });
    expect(container.textContent).toBe("");
    expect(h.calls).toEqual([]);
  });
});

describe("the review, after the run stops", () => {
  const review: ReviewDetail = {
    branch: "b", commits: 1, subjects: ["fix"], judge: null, checks: [], lands: ["merge"], landFailed: null, landAttempts: [], goal: null, answer: null, pullRequests: [], round: null,
    files: [{ path: "src/a.ts", added: 1, removed: 0 }], fileCount: 1, added: 1, removed: 0,
  };

  it("opens its Files list when it was open while the run worked", () => {
    render(<ReviewBody review={review} filesOpen />);
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    cleanup();
    render(<ReviewBody review={review} />);
    expect(screen.queryByText("src/a.ts")).toBeNull();
  });
});
