// @vitest-environment happy-dom
/**
 * A review's Files list opens a file to its diff: click a row (or Enter/Space
 * on it) and the file's unified diff shows under it; click again and it
 * folds. The diff is read the first time a file opens, once per file, from
 * the run's own session through harness-manager's run changes view, which
 * answers only for the task that session ran. A diff too long to show whole
 * says how long it is.
 *
 * Red states this guards: rows that don't open (the review was handed no
 * reader); a read per click instead of per file; the read going to the wrong
 * session or naming no task; a cut diff shown as if whole.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, type ClientFetch } from "@flow-state-dev/client";
import { CODER_FLOW, type ReviewDetail } from "@flow-state-dev/harness-manager/browser";
import { ReviewBody } from "../src/components/TaskReview";
import { runPatchReader } from "../src/lib/run-patch";
import { codingTask } from "./stub-server";

afterEach(cleanup);

const review = (over: Partial<ReviewDetail> = {}): ReviewDetail => ({
  branch: "teammates/t1/fix",
  commits: 1,
  subjects: ["fix"],
  judge: null,
  checks: [],
  lands: ["merge"],
  landFailed: null,
  landAttempts: [],
  goal: null,
  answer: null,
  pullRequests: [],
  round: null,
  files: [
    { path: "labs/teammates/host.mts", added: 3, removed: 2 },
    { path: "packages/claude-code/src/sdk/harness.ts", added: 27, removed: 5 },
  ],
  fileCount: 2,
  added: 30,
  removed: 7,
  ...over,
});

const PATCH = ["diff --git a/labs/teammates/host.mts b/labs/teammates/host.mts", "--- a/labs/teammates/host.mts", "+++ b/labs/teammates/host.mts", "@@ -1,2 +1,2 @@", " keep", "-old line", "+new line"].join("\n");

describe("a review's Files list", () => {
  it("opens a file to its diff under the row and folds it again, reading it once", async () => {
    const loadPatch = vi.fn(async () => ({ patch: PATCH, truncated: false, lines: 7 }));
    render(<ReviewBody review={review()} loadPatch={loadPatch} />);
    fireEvent.click(screen.getByRole("button", { name: /2 files changed/ }));
    const row = screen.getByRole("button", { name: /labs\/teammates\/host\.mts/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(loadPatch).not.toHaveBeenCalled();

    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByText("+new line")).toBeTruthy();
    expect(screen.getByText("-old line")).toBeTruthy();
    expect(screen.getByText("@@ -1,2 +1,2 @@")).toBeTruthy();

    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("+new line")).toBeNull();
    fireEvent.click(row);
    expect(await screen.findByText("+new line")).toBeTruthy();
    expect(loadPatch).toHaveBeenCalledTimes(1);
    expect(loadPatch).toHaveBeenCalledWith("labs/teammates/host.mts");

    // Another file is its own read, and both stay open.
    fireEvent.click(screen.getByRole("button", { name: /harness\.ts/ }));
    expect(loadPatch).toHaveBeenCalledTimes(2);
    expect(loadPatch).toHaveBeenLastCalledWith("packages/claude-code/src/sdk/harness.ts");
  });

  it("says a diff was too large to show whole, with its length", async () => {
    render(<ReviewBody review={review()} loadPatch={async () => ({ patch: "@@ -0,0 +1,9000 @@\n+x", truncated: true, lines: 9_006 })} />);
    fireEvent.click(screen.getByRole("button", { name: /2 files changed/ }));
    fireEvent.click(screen.getByRole("button", { name: /labs\/teammates\/host\.mts/ }));
    expect(await screen.findByText("Diff too large, 9,006 lines: showing the start.")).toBeTruthy();
  });

  it("lists files that don't open when the review has no reader", () => {
    render(<ReviewBody review={review()} />);
    fireEvent.click(screen.getByRole("button", { name: /2 files changed/ }));
    expect((screen.getByRole("button", { name: /labs\/teammates\/host\.mts/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("runPatchReader", () => {
  const host = () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      const path = new URL(url, "http://x").pathname;
      calls.push({ path, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      const output = { taskId: "t1", diff: null, patch: { path: "a.ts", patch: PATCH, truncated: false, lines: 7, verified: true } };
      return new Response(JSON.stringify({ output, topics: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as ClientFetch;
    return { calls, client: createClient({ userId: "u", baseUrl: "", fetcher }) };
  };

  it("reads one file's patch in the run's own session, naming the task", async () => {
    const h = host();
    const task = codingTask({ id: "t1", title: "Fix it", status: "in_progress", harness: "claude-code", run: { sessionId: "run1", requestId: "q1", attempt: 1 }, runFlow: CODER_FLOW });
    const patch = await runPatchReader(h.client, task)!("a.ts");
    expect(patch).toMatchObject({ patch: PATCH, truncated: false, lines: 7 });
    const call = h.calls.find((c) => c.path.endsWith("/views/changes"));
    expect(call?.path).toBe(`/api/flows/${CODER_FLOW}/run1/views/changes`);
    expect(call?.body).toMatchObject({ input: { taskId: "t1", path: "a.ts" } });
  });

  it("offers no reader for a task with no run session, or one not run on the coding flow", () => {
    const h = host();
    const unrun = codingTask({ id: "t1", title: "Fix it", status: "pending", harness: "claude-code", runFlow: CODER_FLOW });
    expect(runPatchReader(h.client, unrun)).toBeUndefined();
    const other = codingTask({ id: "t2", title: "Ask", status: "in_progress", harness: "claude-code", run: { sessionId: "run2", requestId: "q2", attempt: 1 }, runFlow: "agent" });
    expect(runPatchReader(h.client, other)).toBeUndefined();
  });
});
