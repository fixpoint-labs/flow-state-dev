// @vitest-environment happy-dom
// FIX-2396.
/**
 * A coding task's popup sums up what its run did, so you don't open each step
 * group to learn it: one line, "Edited 1 file · ran 1 command",
 * with a chip per file. The files are what the run's harness recorded,
 * read through harness-manager's `readRecordedWork`, never re-parsed from the
 * steps; a harness that records none (Codex and Cursor today) gets no file
 * part, never "0 files". The result box takes how the task ended: a failed
 * task's result is never a success's green. Once it ended, Copy copies the
 * result (else the error), and "Ask Lead to follow up" opens the
 * conversation that filed it with the task named in its composer, unsent.
 *
 * Red states produced before this was trusted: count the run's edit steps
 * instead of the recorded files, and the Codex case fails; colour the result
 * box apart from the lab's one task colour (green whatever the status), and the
 * failed-tone case fails; prefill the open
 * conversation rather than the filer's, and the follow-up case fails; count
 * every recorded row, and a file whose every edit failed reads as edited; let
 * the composer keep the follow-up after taking it, and switching away and back
 * adds it twice; time the duration from the task's first start, and a retry
 * reads as the whole task's time.
 */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Client } from "@flow-state-dev/client";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRecordedFiles } from "../src/app";
import { commandsRun, runSummaryLine } from "../src/components/Popups";
import { call as itemCall, linesOf } from "./lines";
import { App } from "../src/components/App";
import { attemptDurationMs } from "../src/lib/task";
import { scriptedServer } from "./scripted-server";
import { codingTask, stubServer, TestProvider, type StubData, POPUP_READ } from "./stub-server";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const LEAD = "teammates.chief-of-staff";
const TASK = "Coding task: Fix the typo in the README's first line";

/** A harness's tool call as a run's item. */
const call = (name: string, args: Record<string, unknown>, status = "completed", requestId = "q1") => itemCall(`i-${Math.random()}`, requestId, name, args, status);

describe("a run's summary line", () => {
  it("counts the shell commands that ran, not one still running", () => {
    const steps = linesOf([
      call("Bash", { command: "pnpm test" }),
      call("command_execution", { command: "pnpm lint" }, "incomplete"),
      call("shell", { command: "pnpm build" }, "in_progress"),
      call("Edit", { file_path: "/work/README.md" }),
    ]);
    expect(commandsRun(steps)).toBe(2);
  });

  it("counts only the run's own request: a retry in the same session doesn't add the last attempt's commands", () => {
    const steps = linesOf([call("Bash", { command: "ls" }, "completed", "attempt-1"), call("Bash", { command: "pwd" }, "completed", "attempt-2")]);
    expect(commandsRun(steps, "attempt-2")).toBe(1);
    expect(commandsRun(steps)).toBe(2);
  });

  it("reads as one line, leaving out what the run didn't do, and no file part when nothing was recorded", () => {
    expect(runSummaryLine({ files: { count: 3, truncated: false }, commands: 5, durationMs: 134_000 })).toBe("Edited 3 files · ran 5 commands · 2m 14s");
    expect(runSummaryLine({ files: { count: 1, truncated: false }, commands: 0 })).toBe("Edited 1 file");
    expect(runSummaryLine({ files: { count: 200, truncated: true }, commands: 0 })).toBe("Edited 200+ files");
    expect(runSummaryLine({ files: null, commands: 1, durationMs: 4_000 })).toBe("Ran 1 command · 4s");
    expect(runSummaryLine({ files: null, commands: 0 })).toBe("");
  });

  it("times this attempt from its run's start to the task's end, and not while it runs", () => {
    // A retry: the task first started at 1_000; this attempt's run started at 50_000 and the task ended at 184_000.
    const ended = codingTask({ id: "t1", status: "completed", startedAt: 1_000, completedAt: 184_000, run: { sessionId: "s1", requestId: "q2", attempt: 2, startedAt: 50_000 } });
    expect(attemptDurationMs(ended)).toBe(134_000);
    expect(attemptDurationMs({ ...ended, status: "in_progress" })).toBeUndefined();
    expect(attemptDurationMs({ ...ended, completedAt: undefined })).toBeUndefined();
  });
});

/** A run's items in its session, as a harness reports them: what its run did to fix the typo. */
const ran = (harness: "claude-code" | "codex") =>
  (harness === "claude-code"
    ? [call("Read", { file_path: "/work/README.md" }), call("Edit", { file_path: "/work/README.md" }), call("Bash", { command: "pnpm docs:check" })]
    : [call("command_execution", { command: "sed -n 1p README.md" }), call("file_change", { changes: [{ path: "/work/README.md", kind: "update" }] }), call("command_execution", { command: "pnpm docs:check" })]
  ).map((item) => ({ ...item, provenance: { blockName: `${harness}-agent` } }));

/** A finished coding task on `harness`, filed from Lead's conversation, its run in `run-1`, 12 s long. */
const finished = (harness: "claude-code" | "codex", fields: Partial<CodingBoardTask> = {}) =>
  codingTask({
    id: "t1",
    assignee: `teammates.${harness}`,
    harness,
    title: "Fix the typo in the README's first line",
    status: "completed",
    completedAt: 60_000,
    run: { sessionId: "run-1", requestId: "q1", attempt: 1, startedAt: 48_000 },
    detail: { answer: "Fixed the typo in README.md, line 1.", answerCut: false },
    ...fields,
  });

/** The lab, with Lead's conversation's task `row` on a stand-in board, opened by its address. */
function openByAddress(row: CodingBoardTask, data: Omit<StubData, "board"> = {}) {
  window.history.replaceState(null, "", `/?worker=${LEAD}&session=conversation:${LEAD}&task=${row.id}`);
  const server = stubServer({ board: { [`conversation:${LEAD}`]: [row] }, items: { "run-1": ran(row.harness === "codex" ? "codex" : "claude-code") }, ...data });
  render(<TestProvider server={scriptedServer({ speed: 0.05 })} client={server.client}><App /></TestProvider>);
  return screen.findByRole("dialog", { name: TASK }, POPUP_READ);
}

describe("a coding task's popup", () => {
  it("sums up a finished Claude Code run from what it recorded: files and commands, a chip per file", async () => {
    const popup = await openByAddress(finished("claude-code"), { recorded: { "run-1": { files: ["/work/README.md"] } } });
    await waitFor(() => expect(popup.querySelector("[data-summary-line]")?.textContent).toBe("Edited 1 file · ran 1 command · 12s"));
    const chips = within(popup).getByRole("list", { name: "Files changed" });
    expect(within(chips).getByText("README.md").getAttribute("title")).toBe("/work/README.md");
    expect(within(popup).getByRole("region", { name: "Result" }).getAttribute("data-tone")).toBe("done");
  });

  it("counts a file only when an edit to it landed, not when every attempt failed", async () => {
    const popup = await openByAddress(finished("claude-code"), { recorded: { "run-1": { files: ["/work/README.md", { path: "/work/LICENSE", applied: 0 }] } } });
    await waitFor(() => expect(popup.querySelector("[data-summary-line]")?.textContent).toBe("Edited 1 file · ran 1 command · 12s"));
    expect(within(popup).queryByText("LICENSE")).toBeNull();
  });

  it("counts a file once when the run edited it again after a steer or a review's changes", async () => {
    const popup = await openByAddress(finished("claude-code"), { recorded: { "run-1": { files: ["/work/README.md", "/work/README.md"] } } });
    await waitFor(() => expect(popup.querySelector("[data-summary-line]")?.textContent).toBe("Edited 1 file · ran 1 command · 12s"));
    expect(within(popup).getAllByText("README.md").filter((el) => el.hasAttribute("data-file-chip"))).toHaveLength(1);
  });

  it("says no file count for a harness that records none, though its run edited one", async () => {
    const popup = await openByAddress(finished("codex"), { recorded: { "run-1": {} } });
    await waitFor(() => expect(popup.querySelector("[data-summary-line]")?.textContent).toBe("Ran 2 commands · 12s"));
    expect(within(popup).queryByRole("list", { name: "Files changed" })).toBeNull();
  });

  it("copies the result", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const popup = await openByAddress(finished("codex"));
    await within(popup).findByRole("region", { name: "Result" });
    await act(async () => fireEvent.click(within(popup).getByRole("button", { name: "Copy" })));
    expect(writeText).toHaveBeenCalledWith("Fixed the typo in README.md, line 1.");
    expect(within(popup).getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("asks the worker that filed it to follow up: its conversation opens with the task named in the composer", async () => {
    const popup = await openByAddress(finished("codex"));
    await within(popup).findByRole("region", { name: "Result" });
    fireEvent.click(within(popup).getByRole("button", { name: "Ask Lead to follow up" }));
    expect(screen.queryByRole("dialog", { name: TASK })).toBeNull();
    const box = (await screen.findByLabelText("Message Lead")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe(`Follow up on "Fix the typo in the README's first line": `));
  });
});

describe("the files a popup reads", () => {
  it("never shows one attempt's files for the next: a retry's run starts with none until its own are read", async () => {
    let answer: ((items: { topic: string; clientData: unknown }[]) => void) | undefined;
    // harness-manager's direct read, over a client that answers attempt 1's files at once and holds attempt 2's.
    const client = {
      resources: {
        getResourceManifest: async () => ({ resources: [{ kind: "collection", ref: "files", pattern: "observed-file-ops/**", client: { state: { read: true } } }] }),
        listCollectionResources: (_session: string, _ref: string, { topicPrefix }: { topicPrefix: string }) =>
          topicPrefix.includes("req-1")
            ? Promise.resolve({ items: [{ topic: "req-1/inv/a.ts", clientData: { lastKind: "edited", appliedCount: 1 } }], nextCursor: null })
            : new Promise((resolve) => (answer = (items) => resolve({ items, nextCursor: null }))),
      },
    } as unknown as Client;
    const task = (requestId: string, status: string) => codingTask({ id: "t1", assignee: "w", title: "T", status, run: { sessionId: "run:t1", requestId, attempt: 1 } });
    const wrapper = ({ children }: { children: ReactNode }) => <TestProvider client={client}>{children}</TestProvider>;
    const { result, rerender } = renderHook(({ t }) => useRecordedFiles(t), { initialProps: { t: task("req-1", "errored") }, wrapper });
    await waitFor(() => expect(result.current?.rows.map((r) => r.path)).toEqual(["a.ts"]));
    rerender({ t: task("req-2", "in_progress") });
    expect(result.current).toBeUndefined();
    // Attempt 2's read is out, and nothing of attempt 1's shows meanwhile.
    await waitFor(() => expect(answer).toBeDefined());
    expect(result.current).toBeUndefined();
    await act(async () => answer!([]));
    expect(result.current?.rows).toEqual([]);
  });
});

describe("a filed task's popup, opened by its address", () => {
  const failed = codingTask({
    id: "t-failed",
    assignee: "teammates.writer",
    title: "Draft the PM role",
    status: "errored",
    detail: { answer: "Half a draft, in the doc.", answerCut: false },
    error: "Ran out of time.",
  });
  const open = (task: CodingBoardTask, worker = LEAD) => {
    window.history.replaceState(null, "", `/?worker=${worker}&session=conversation:${LEAD}&task=${task.id}`);
    const server = stubServer({ board: { [`conversation:${LEAD}`]: [task] } });
    render(<TestProvider server={scriptedServer({ speed: 0.05 })} client={server.client}><App /></TestProvider>);
    return screen.findByRole("dialog", { name: "Asked writer to draft the PM role" }, POPUP_READ);
  };

  it("colours a failed task's result as failed, not as a success", async () => {
    const popup = await open(failed);
    const result = await within(popup).findByRole("region", { name: "Result" });
    expect(result.getAttribute("data-tone")).toBe("failed");
    // The colour is the lab's one task colour, the same red its row and card use.
    expect(result.className).toContain("text-destructive");
  });

  it("prefills the filer's conversation, not the one that was open, and keeps what was typed there", async () => {
    window.localStorage.setItem(`teammates:draft:conversation:${LEAD}`, "Also check the dates.");
    const popup = await open(failed, "teammates.researcher");
    fireEvent.click(within(popup).getByRole("button", { name: "Ask Lead to follow up" }));
    const box = (await screen.findByLabelText("Message Lead")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe(`Also check the dates.\n\nFollow up on "Draft the PM role": `));
    expect(screen.queryByLabelText("Message researcher")).toBeNull();
  });

  it("adds the follow-up once: switching away and back doesn't add it again", async () => {
    const popup = await open(failed);
    fireEvent.click(within(popup).getByRole("button", { name: "Ask Lead to follow up" }));
    const ask = `Follow up on "Draft the PM role": `;
    await waitFor(async () => expect(((await screen.findByLabelText("Message Lead")) as HTMLTextAreaElement).value).toBe(ask));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Workers" })).getByRole("button", { name: /researcher/ }));
    await screen.findByLabelText("Message researcher");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Workers" })).getByRole("button", { name: /Lead/ }));
    const box = (await screen.findByLabelText("Message Lead")) as HTMLTextAreaElement;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(box.value).toBe(ask);
  });
});
