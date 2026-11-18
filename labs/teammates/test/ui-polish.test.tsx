// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppCalls, BoardTask, ConversationEntry, SessionStep } from "../src/app";
import { Entry } from "../src/components/Entry";
import { PopupView } from "../src/components/Popups";
import { StatusBadge } from "../src/components/StatusBadge";
import { lookOf } from "../src/lib/looks";
import { taskPresentation } from "../src/lib/task-presentation";

afterEach(cleanup);
const names = (id: string) => id;
const looks = (id: string) => lookOf({ id, name: id });
const entryProps = { workerName: "Lead", nameOf: names, lookOf: looks };
const FINDINGS = "# Research findings\n\nParallel is configured for web search.\n\n" + Array.from({ length: 16 }, (_, i) => `- Finding ${i + 1}: source details and supporting evidence.`).join("\n") + "\n\nThe original final detail is **preserved**.";

describe("readable replies", () => {
  it("opens a long reply by default and lets the reader fold it with an explicitly connected control", () => {
    const draw = (text: string) => <Entry {...entryProps} entry={{ kind: "assistant", id: "a1", text, streaming: true }} />;
    const view = render(draw(FINDINGS));
    const control = screen.getByRole("button", { name: "Collapse reply" });
    expect(control.getAttribute("aria-expanded")).toBe("true");
    const body = document.getElementById(control.getAttribute("aria-controls")!)!;
    expect(body.hidden).toBe(false);
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(body.hidden).toBe(true);
    view.rerender(draw(`${FINDINGS}\n\nMore words streamed in.`));
    expect(control.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(control);
    expect(body.textContent).toContain("More words streamed in.");
    expect(body.hidden).toBe(false);
  });

  it("keeps an older reply folded while a new reply arrives readable", () => {
    const draw = (latest: boolean) => <>
      <Entry {...entryProps} entry={{ kind: "assistant", id: "a1", text: FINDINGS }} />
      {latest ? <Entry {...entryProps} entry={{ kind: "assistant", id: "a2", text: `Newest answer\n\n${FINDINGS}` }} /> : null}
    </>;
    const view = render(draw(false));
    fireEvent.click(screen.getByRole("button", { name: "Collapse reply" }));
    view.rerender(draw(true));
    expect(screen.getByRole("button", { name: "Expand reply · full details" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Collapse reply" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Newest answer")).toBeTruthy();
  });

  it.each([
    { kind: "received", id: "m1", messageId: "m1", from: "researcher", text: FINDINGS },
    { kind: "result", id: "r1", taskId: "", from: "researcher", text: FINDINGS },
    { kind: "result", id: "r2", taskId: "task_r", title: "Research search tools", from: "researcher", text: FINDINGS },
  ] satisfies ConversationEntry[])("previews a long $kind and expands its original details inline", (entry) => {
    const view = render(<Entry {...entryProps} entry={entry} onOpenTask={() => {}} />);
    expect(view.container.querySelector("[data-reply-preview]")?.textContent).toContain("Parallel is configured for web search.");
    expect(screen.queryByText(/The original final detail/)).toBeNull();
    const expand = screen.getByRole("button", { name: /Expand (message|result) · full details/ });
    fireEvent.click(expand);
    expect(view.container.textContent).toContain("The original final detail is preserved.");
    expect(view.container.querySelectorAll("li")).toHaveLength(16);
    expect(expand.getAttribute("aria-expanded")).toBe("true");
  });

  it("draws a short reply as plain text, with no fold control to skip past", () => {
    render(<Entry {...entryProps} entry={{ kind: "assistant", id: "a1", text: "Done." }} />);
    expect(screen.getByText("Done.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Collapse|Expand/ })).toBeNull();
  });

  it("folds a message to its excerpt once it grows past the long line, not only when it arrives long", () => {
    const draw = (text: string) => <Entry {...entryProps} entry={{ kind: "received", id: "m1", messageId: "m1", from: "researcher", text }} />;
    const view = render(draw("Parallel is configured for web search."));
    expect(view.container.querySelector("[data-reply-preview]")).toBeNull();
    view.rerender(draw(FINDINGS));
    expect(view.container.querySelector("[data-reply-preview]")?.textContent).toContain("Parallel is configured for web search.");
    expect(screen.getByRole("button", { name: "Expand message · full details" })).toBeTruthy();
  });

  it("shows streaming activity while folded, then stops when the answer finishes or is interrupted", () => {
    const draw = (streaming: boolean, incomplete = false) => <Entry {...entryProps} entry={{ kind: "assistant", id: "a1", text: FINDINGS, streaming, incomplete }} />;
    const view = render(draw(true));
    fireEvent.click(screen.getByRole("button", { name: "Collapse reply" }));
    expect(screen.getByRole("status").textContent).toBe("Reply in progress");
    expect(view.container.querySelector("[data-typing-dots]")?.getAttribute("aria-hidden")).toBe("true");
    view.rerender(draw(false));
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(draw(true, true));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("holds a streaming reply's dots still once the feed goes stale", () => {
    const draw = (stale: boolean) => <Entry {...entryProps} stale={stale} entry={{ kind: "assistant", id: "a1", text: "Answer in progress", streaming: true }} />;
    const view = render(draw(false));
    const dots = () => view.container.querySelector("[data-typing-dots]")?.getAttribute("data-active");
    expect(dots()).toBe("true");
    view.rerender(draw(true));
    expect(dots()).toBe("false");
  });
});

describe("task activity", () => {
  it("uses text as well as a decorative dot, with motion only for active work", () => {
    const view = render(<StatusBadge label="running" tone="info" active />);
    expect(view.container.textContent).toBe("running");
    const dot = view.container.querySelector('[aria-hidden="true"]')!;
    expect(dot.className).toContain("motion-safe:animate-pulse");
    view.rerender(<StatusBadge label="done" tone="success" />);
    expect(view.container.textContent).toBe("done");
    expect(dot.className).not.toContain("animate");
  });

  it("colours a task's badge from taskPresentation, so a quiet run keeps its warning colour", () => {
    // A quiet run is read through taskPresentation's signal; the badge takes that tone rather than guessing from the word.
    const quiet = taskPresentation({ status: "running" }, "quiet");
    const view = render(<StatusBadge label={quiet.word} tone={quiet.badge} />);
    const badge = view.container.querySelector("[data-status-badge]")!;
    expect(badge.getAttribute("data-tone")).toBe("warning");
    expect(badge.className).toContain("text-warning");
    expect(taskPresentation({ status: "failed" }).badge).toBe("destructive");
    expect(taskPresentation({ status: "done" }).badge).toBe("success");
    expect(taskPresentation({ status: "cancelled" }).badge).toBe("muted");
  });

  it("keeps steer below the log, with its draft and focus intact as output grows", () => {
    let publish: (steps: SessionStep[]) => void = () => {};
    const task: BoardTask = { id: "task_r", to: "researcher", title: "Find sources", goal: "Find sources", status: "running", boardStatus: "in_progress", runSessionId: "run_r" };
    const adapter = {
      watchTasks: (_: string, show: (tasks: BoardTask[]) => void) => { show([task]); return () => {}; },
      watchRun: (_: string, show: typeof publish) => { publish = show; show([{ id: "first", kind: "said", text: "Starting research" }]); return () => {}; },
      watchWorking: () => () => {},
      taskActions: () => ({}),
    } as unknown as AppCalls;
    render(<PopupView adapter={adapter} popup={{ kind: "task", sessionId: "s1", taskId: task.id }} nameOf={names} lookOf={looks} isCoding={() => false} coders={[]} onClose={() => {}} />);
    const popup = screen.getByRole("dialog");
    const box = within(popup).getByRole("textbox", { name: "Steer this task" });
    const footer = box.closest("footer")!;
    expect(footer).not.toBeNull();
    // Anchored like a chat composer: the dialog's last row, outside the scrolling log, with Cancel beside it.
    expect(popup.lastElementChild).toBe(footer);
    const log = footer.previousElementSibling!;
    expect(log.className).toContain("overflow-y-auto");
    expect(log.contains(box)).toBe(false);
    expect(log.contains(popup.querySelector("[data-step=said]"))).toBe(true);
    expect(within(footer).getByRole("button", { name: "Cancel" })).toBeTruthy();
    fireEvent.change(box, { target: { value: "Focus on primary sources" } });
    box.focus();
    act(() => publish(Array.from({ length: 50 }, (_, i) => ({ id: `step-${i}`, kind: "said", text: `Research note ${i}` }))));
    expect(within(popup).getByRole("textbox", { name: "Steer this task" })).toBe(box);
    expect((box as HTMLInputElement).value).toBe("Focus on primary sources");
    expect(document.activeElement).toBe(box);
    expect(popup.querySelectorAll("[data-step=said]")).toHaveLength(50);
    // Every step, the newest included, still sits above the Steer box.
    const newest = [...popup.querySelectorAll("[data-step=said]")].at(-1)!;
    expect(newest.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(popup.lastElementChild).toBe(footer);
    expect(footer.className).toContain("shrink-0");
  });
});
