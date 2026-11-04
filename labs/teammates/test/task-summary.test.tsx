// @vitest-environment happy-dom
/**
 * A coding task's popup sums up what its run did, so you don't open each step
 * group to learn it (FIX-2396): one line, "Edited 1 file · ran 1 command",
 * with a chip per file. The files are what the run's harness recorded,
 * read through harness-manager's `readRecordedWork`, never re-parsed from the
 * steps; a harness that records none (Codex and Cursor today) gets no file
 * part, never "0 files". The result box takes how the task ended: a failed
 * task's result is never a success's green. Once it ended, Copy copies the
 * result (else the error), and "Ask Chief of Staff to follow up" opens the
 * conversation that filed it with the task named in its composer, unsent.
 *
 * Red states produced before this was trusted: count the run's edit steps
 * instead of the recorded files, and the Codex case fails; colour the result
 * green whatever the status, and the failed-tone case fails; prefill the open
 * conversation rather than the filer's, and the follow-up case fails.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commandsRun, runSummaryLine, runSteps, toBoardTask, type BoardTask } from "../src/adapter";
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

describe("a run's summary line", () => {
  it("counts the shell commands that ran, not one still running", () => {
    const steps = runSteps([
      call("Bash", { command: "pnpm test" }),
      call("command_execution", { command: "pnpm lint" }, "incomplete"),
      call("shell", { command: "pnpm build" }, "in_progress"),
      call("Edit", { file_path: "/work/README.md" }),
    ] as never);
    expect(commandsRun(steps)).toBe(2);
  });

  it("reads as one line, leaving out what the run didn't do, and no file part when nothing was recorded", () => {
    expect(runSummaryLine({ files: { count: 3, truncated: false }, commands: 5, durationMs: 134_000 })).toBe("Edited 3 files · ran 5 commands · 2m 14s");
    expect(runSummaryLine({ files: { count: 1, truncated: false }, commands: 0 })).toBe("Edited 1 file");
    expect(runSummaryLine({ files: { count: 200, truncated: true }, commands: 0 })).toBe("Edited 200+ files");
    expect(runSummaryLine({ files: null, commands: 1, durationMs: 4_000 })).toBe("Ran 1 command · 4s");
    expect(runSummaryLine({ files: null, commands: 0 })).toBe("");
  });

  it("carries the run's request beside its session, so the recorded work can be read", () => {
    const task = toBoardTask({ id: "t1", status: "completed", assignee: "x", title: "t", run: { sessionId: "s1", requestId: "q9", attempt: 1 } });
    expect([task.runSessionId, task.runRequestId]).toEqual(["s1", "q9"]);
  });
});

/** Ask Chief of Staff to have `agent` fix the typo; open its popup. */
async function openTask(agent = "Codex") {
  const box = await screen.findByLabelText("Message Chief of Staff");
  await act(async () => {
    fireEvent.change(box, { target: { value: `Have ${agent} fix the typo in the README's first line.` } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
  const conversation = screen.getByRole("main", { name: "Conversation" });
  fireEvent.click(await within(conversation).findByRole("button", { name: new RegExp(`^${TASK}, on ${agent}`) }, { timeout: 3000 }));
  return screen.findByRole("dialog", { name: TASK });
}

describe("a coding task's popup", () => {
  it("sums up a finished Claude Code run from what it recorded: files and commands, a chip per file", async () => {
    render(<App adapter={createFixtureLab({ speed: 0.05 })} />);
    const popup = await openTask("Claude Code");
    await within(popup).findByRole("region", { name: "Result" }, { timeout: 3000 });
    await waitFor(() => expect(popup.querySelector("[data-summary-line]")?.textContent).toBe("Edited 1 file · ran 1 command"));
    const chips = within(popup).getByRole("list", { name: "Files changed" });
    expect(within(chips).getByText("README.md").getAttribute("title")).toBe("/work/README.md");
    expect(within(popup).getByRole("region", { name: "Result" }).getAttribute("data-tone")).toBe("done");
  });

  it("says no file count for a harness that records none, though its run edited one", async () => {
    render(<App adapter={createFixtureLab({ speed: 0.05 })} />);
    const popup = await openTask("Codex");
    await within(popup).findByRole("region", { name: "Result" }, { timeout: 3000 });
    await waitFor(() => expect(popup.querySelector("[data-summary-line]")?.textContent).toBe("Ran 2 commands"));
    expect(within(popup).queryByRole("list", { name: "Files changed" })).toBeNull();
  });

  it("copies the result", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<App adapter={createFixtureLab({ speed: 0.05 })} />);
    const popup = await openTask();
    await within(popup).findByRole("region", { name: "Result" }, { timeout: 3000 });
    await act(async () => fireEvent.click(within(popup).getByRole("button", { name: "Copy" })));
    expect(writeText).toHaveBeenCalledWith("Fixed the typo in README.md, line 1.");
    expect(within(popup).getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("asks the worker that filed it to follow up: its conversation opens with the task named in the composer", async () => {
    render(<App adapter={createFixtureLab({ speed: 0.05 })} />);
    const popup = await openTask();
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
