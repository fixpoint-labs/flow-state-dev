// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppCalls, BoardTask, ConversationEntry, SessionStep } from "../src/app";
import { Entry } from "../src/components/Entry";
import { PopupView } from "../src/components/Popups";
import { StatusBadge } from "../src/components/StatusBadge";
import { lookOf } from "../src/lib/looks";
import { replyPreview } from "../src/lib/reply-preview";

afterEach(cleanup);
const names = (id: string) => id;
const looks = (id: string) => lookOf({ id, name: id });
const entryProps = { workerName: "Lead", nameOf: names, lookOf: looks };
const FINDINGS = "# Research findings\n\nParallel is configured for web search.\n\n" + Array.from({ length: 16 }, (_, i) => `- Finding ${i + 1}: source details and supporting evidence.`).join("\n") + "\n\nThe original final detail is **preserved**.";

describe("readable replies", () => {
  it("opens replies by default and lets the reader fold them with an explicitly connected control", () => {
    const draw = (text: string) => <Entry {...entryProps} entry={{ kind: "assistant", id: "a1", text, streaming: true }} />;
    const view = render(draw("The answer so far."));
    const control = screen.getByRole("button", { name: "Collapse reply" });
    expect(control.getAttribute("aria-expanded")).toBe("true");
    const body = document.getElementById(control.getAttribute("aria-controls")!)!;
    expect(body.hidden).toBe(false);
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(body.hidden).toBe(true);
    view.rerender(draw("The answer so far. More words streamed in."));
    expect(control.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(control);
    expect(body.textContent).toContain("More words streamed in.");
    expect(body.hidden).toBe(false);
  });

  it("keeps an older reply folded while a new reply arrives readable", () => {
    const draw = (latest: boolean) => <>
      <Entry {...entryProps} entry={{ kind: "assistant", id: "a1", text: "Earlier answer" }} />
      {latest ? <Entry {...entryProps} entry={{ kind: "assistant", id: "a2", text: "Newest answer" }} /> : null}
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

  it("makes a bounded excerpt from prose instead of raw headings, pipes and link markup", () => {
    const preview = replyPreview("# Findings\n\nSearch is **ready** via [Parallel](https://example.com).\n\n| key | value |\n| --- | --- |\n" + "Evidence from the source. ".repeat(40));
    expect(preview).toMatch(/^Search is ready via Parallel\./);
    expect(preview.length).toBeLessThanOrEqual(361);
    expect(preview).not.toMatch(/\||\*\*|https:/);
    expect(replyPreview("```ts\nconst value = 1;\n```")).toBe("const value = 1;");
    expect(replyPreview("# Ready to ship")).toBe("Ready to ship");
    expect(replyPreview("Updated `my_file.ts` with **passing** checks.")).toBe("Updated my_file.ts with passing checks.");
    expect(replyPreview("~~~sh\ngit status --short\n~~~")).toBe("git status --short");
    expect(replyPreview("One\nTwo\nThree\nFour")).toBe("One Two Three…");
    expect(replyPreview("")).toBe("");
  });

  it.each([
    { kind: "received", id: "m1", messageId: "m1", from: "researcher", text: "Found the primary source." },
    { kind: "result", id: "r1", taskId: "task_r", from: "researcher", text: "The check passed." },
  ] satisfies ConversationEntry[])("lets the reader collapse even a short $kind without opening a task", (entry) => {
    let opened = false;
    const view = render(<Entry {...entryProps} entry={entry} onOpenTask={() => { opened = true; }} />);
    fireEvent.click(screen.getByRole("button", { name: /Collapse (message|result)/ }));
    expect(view.container.querySelector("[data-reply-preview]")?.textContent).toBe(entry.text);
    expect(opened).toBe(false);
  });

  it("shows streaming activity while folded, then stops when the answer finishes or is interrupted", () => {
    const draw = (streaming: boolean, incomplete = false) => <Entry {...entryProps} entry={{ kind: "assistant", id: "a1", text: "Answer in progress", streaming, incomplete }} />;
    const view = render(draw(true));
    fireEvent.click(screen.getByRole("button", { name: "Collapse reply" }));
    expect(screen.getByRole("status").textContent).toBe("Reply in progress");
    expect(view.container.querySelector("[data-typing-dots]")?.getAttribute("aria-hidden")).toBe("true");
    view.rerender(draw(false));
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(draw(true, true));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("task activity", () => {
  it("uses text as well as a decorative dot, with motion only for active work", () => {
    const view = render(<StatusBadge status="running" />);
    expect(view.container.textContent).toBe("running");
    const dot = view.container.querySelector('[aria-hidden="true"]')!;
    expect(dot.className).toContain("motion-safe:animate-pulse");
    view.rerender(<StatusBadge status="done" />);
    expect(view.container.textContent).toBe("done");
    expect(dot.className).not.toContain("animate");
  });

  it("keeps steer below the log, with its draft and focus intact as output grows", () => {
    let publish: (steps: SessionStep[]) => void = () => {};
    const task: BoardTask = { id: "task_r", to: "researcher", title: "Find sources", goal: "Find sources", status: "running", boardStatus: "in_progress", runSessionId: "run_r" };
    const adapter = {
      watchTasks: (_: string, show: (rows: BoardTask[]) => void) => { show([task]); return () => {}; },
      watchRun: (_: string, show: typeof publish) => { publish = show; show([{ id: "first", kind: "said", text: "Starting research" }]); return () => {}; },
      watchWorking: () => () => {},
      taskActions: () => ({}),
    } as unknown as AppCalls;
    render(<PopupView adapter={adapter} popup={{ kind: "task", sessionId: "s1", taskId: task.id }} nameOf={names} lookOf={looks} isCoding={() => false} coders={[]} onClose={() => {}} />);
    const popup = screen.getByRole("dialog");
    const box = within(popup).getByRole("textbox", { name: "Steer this task" });
    const footer = box.closest("footer")!;
    expect(footer).not.toBeNull();
    expect(footer.previousElementSibling?.contains(popup.querySelector("[data-step=said]"))).toBe(true);
    fireEvent.change(box, { target: { value: "Focus on primary sources" } });
    box.focus();
    act(() => publish(Array.from({ length: 50 }, (_, i) => ({ id: `step-${i}`, kind: "said", text: `Research note ${i}` }))));
    expect(within(popup).getByRole("textbox", { name: "Steer this task" })).toBe(box);
    expect((box as HTMLInputElement).value).toBe("Focus on primary sources");
    expect(document.activeElement).toBe(box);
    expect(popup.querySelectorAll("[data-step=said]")).toHaveLength(50);
    expect(footer.className).toContain("shrink-0");
  });
});
