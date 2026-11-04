// @vitest-environment happy-dom
/**
 * A coding task's popup sums up what its run did, so you don't open each step
 * group to learn it (FIX-2396): one line, "Edited 1 file · ran 2 commands ·
 * 2s", with a chip per file changed. Files are counted, not edit calls, and a
 * failed edit changed nothing. The result box takes how the task ended: a
 * failed task's result is never a success's green. Once it ended, Copy copies
 * the result (else the error), and "Ask Chief of Staff to follow up" opens
 * the conversation that filed it with the task named in its composer, unsent.
 *
 * Red states produced before this was trusted: count edit calls instead of
 * distinct paths, and the two-edits case fails; drop the `completed` check,
 * and the failed-edit case fails; colour the result green whatever the
 * status, and the failed-tone case fails; prefill the selected conversation
 * rather than the filer's, and the follow-up case fails.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSummary, runSummaryLine, runSteps, toBoardTask, type BoardTask } from "../src/adapter";
import { App } from "../src/App";
import { createFixtureLab } from "./fake-lab";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const LEAD = "teammates.chief-of-staff";
const TASK = "Coding task: Fix the typo in the README's first line";

/** A harness's tool call as a run's item. */
const call = (name: string, args: Record<string, unknown>, status = "completed") => ({
  id: `i-${Math.random()}`,
  type: "tool_output",
  status,
  requestId: "q1",
  toolCall: { name, arguments: JSON.stringify(args) },
  output: {},
});

describe("a run's summary, from its steps", () => {
  it("counts files, not edit calls, across each harness's tool shapes", () => {
    const steps = runSteps([
      call("Edit", { file_path: "/work/README.md", old_string: "a", new_string: "b" }),
      call("Edit", { file_path: "/work/README.md", old_string: "c", new_string: "d" }),
      call("Write", { file_path: "/work/docs/new.md", content: "x" }),
      call("file_change", { changes: [{ path: "/work/src/a.ts", kind: "update" }, { path: "/work/README.md", kind: "update" }] }),
      call("edit", { path: "/work/src/b.ts" }),
      call("Read", { file_path: "/work/src/c.ts" }),
    ] as never);
    expect(runSummary(steps).files).toEqual(["/work/README.md", "/work/docs/new.md", "/work/src/a.ts", "/work/src/b.ts"]);
  });

  it("leaves out an edit that failed or is still running, and counts commands that ran", () => {
    const steps = runSteps([
      call("Edit", { file_path: "/work/failed.md" }, "incomplete"),
      call("Edit", { file_path: "/work/running.md" }, "in_progress"),
      call("Bash", { command: "pnpm test" }),
      call("command_execution", { command: "pnpm lint" }, "incomplete"),
      call("shell", { command: "pnpm build" }, "in_progress"),
    ] as never);
    const summary = runSummary(steps);
    expect(summary.files).toEqual([]);
    expect(summary.commands).toBe(2);
  });

  it("reads as one line, leaving out what the run didn't do", () => {
    expect(runSummaryLine({ files: ["a", "b", "c"], commands: 5 }, 134_000)).toBe("Edited 3 files · ran 5 commands · 2m 14s");
    expect(runSummaryLine({ files: ["a"], commands: 0 })).toBe("Edited 1 file");
    expect(runSummaryLine({ files: [], commands: 1 }, 4_000)).toBe("Ran 1 command · 4s");
    expect(runSummaryLine({ files: [], commands: 0 })).toBe("");
  });
});

describe("a task's duration, from its row", () => {
  it("is completed minus started once the task ended, and absent while it runs", () => {
    expect(toBoardTask({ id: "t1", status: "completed", assignee: "x", title: "t", startedAt: 1_000, completedAt: 135_000 }).durationMs).toBe(134_000);
    expect(toBoardTask({ id: "t2", status: "in_progress", assignee: "x", title: "t", startedAt: 1_000 }).durationMs).toBeUndefined();
    expect(toBoardTask({ id: "t3", status: "errored", assignee: "x", title: "t", completedAt: 5_000 }).durationMs).toBeUndefined();
  });
});

/** Ask Chief of Staff to have Codex fix the typo; open its popup. */
async function openCodexTask() {
  const box = await screen.findByLabelText("Message Chief of Staff");
  await act(async () => {
    fireEvent.change(box, { target: { value: "Have Codex fix the typo in the README's first line." } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
  const conversation = screen.getByRole("main", { name: "Conversation" });
  fireEvent.click(await within(conversation).findByRole("button", { name: new RegExp(`^${TASK}, on Codex`) }, { timeout: 3000 }));
  return screen.findByRole("dialog", { name: TASK });
}

describe("a coding task's popup", () => {
  it("sums up the finished run: files and commands, how long, and a chip per file", async () => {
    let clock = 0;
    render(<App adapter={createFixtureLab({ speed: 0.05, now: () => (clock += 250) })} />);
    const popup = await openCodexTask();
    await within(popup).findByRole("region", { name: "Result" }, { timeout: 3000 });
    const line = popup.querySelector("[data-summary-line]")?.textContent ?? "";
    expect(line).toMatch(/^Edited 1 file · ran 2 commands · \d+s$/);
    const chips = within(popup).getByRole("list", { name: "Files changed" });
    expect(within(chips).getByText("README.md").getAttribute("title")).toBe("/work/README.md");
    expect(within(popup).getByRole("region", { name: "Result" }).getAttribute("data-tone")).toBe("done");
  });

  it("copies the result", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<App adapter={createFixtureLab({ speed: 0.05 })} />);
    const popup = await openCodexTask();
    await within(popup).findByRole("region", { name: "Result" }, { timeout: 3000 });
    await act(async () => fireEvent.click(within(popup).getByRole("button", { name: "Copy" })));
    expect(writeText).toHaveBeenCalledWith("Fixed the typo in README.md, line 1.");
    expect(within(popup).getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("asks the worker that filed it to follow up: its conversation opens with the task named in the composer", async () => {
    render(<App adapter={createFixtureLab({ speed: 0.05 })} />);
    const popup = await openCodexTask();
    await within(popup).findByRole("region", { name: "Result" }, { timeout: 3000 });
    fireEvent.click(within(popup).getByRole("button", { name: "Ask Chief of Staff to follow up" }));
    expect(screen.queryByRole("dialog", { name: TASK })).toBeNull();
    const box = (await screen.findByLabelText("Message Chief of Staff")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe(`Follow up on "Fix the typo in the README's first line": `));
  });
});

describe("a filed task's popup, opened by its address", () => {
  const failed: BoardTask & { filer: string } = {
    id: "t-failed",
    to: "teammates.writer",
    title: "Draft the PM role",
    goal: "Draft the PM role",
    status: "failed",
    boardStatus: "errored",
    result: "Half a draft, in the doc.",
    error: "Ran out of time.",
    filer: LEAD,
  };
  const open = (task: BoardTask & { filer: string }, worker = LEAD) => {
    window.history.replaceState(null, "", `/?worker=${worker}&session=conversation:${task.filer}&task=${task.id}`);
    render(<App adapter={createFixtureLab({ speed: 0.05, tasks: [task] })} />);
    return screen.findByRole("dialog", { name: "Asked writer to draft the PM role" });
  };

  it("colours a failed task's result as failed, not as a success", async () => {
    const popup = await open(failed);
    expect(within(popup).getByRole("region", { name: "Result" }).getAttribute("data-tone")).toBe("failed");
  });

  it("prefills the filer's conversation, not the one that was open, and keeps what was typed there", async () => {
    window.localStorage.setItem(`teammates:draft:conversation:${LEAD}`, "Also check the dates.");
    const popup = await open({ ...failed, filer: LEAD }, "teammates.researcher");
    fireEvent.click(within(popup).getByRole("button", { name: "Ask Chief of Staff to follow up" }));
    const box = (await screen.findByLabelText("Message Chief of Staff")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe(`Also check the dates.\n\nFollow up on "Draft the PM role": `));
    expect(screen.queryByLabelText("Message researcher")).toBeNull();
  });
});
