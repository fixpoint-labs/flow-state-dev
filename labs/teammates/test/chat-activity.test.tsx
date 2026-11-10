// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionConnectionStatus } from "@flow-state-dev/client";
import { stepRun, toEntries, type ConversationEntry, type ConversationView, type LabAdapter, type SessionStep } from "../src/adapter";
import { Conversation } from "../src/components/Conversation";
import { STALE_CLASS } from "../src/components/flow-state/connection-banner";
import { chatActivity } from "../src/lib/chat-activity";
import { lookOf } from "../src/lib/looks";

afterEach(cleanup);

const steps = (...steps: SessionStep[]): ConversationEntry => ({ kind: "steps", id: "tools", steps, ...stepRun(steps) });
const read: SessionStep = { kind: "tool", id: "read", tool: "readProjectSource", state: "running", text: "private file contents and arguments" };

describe("assistant activity", () => {
  it("names the latest active tool without using its text, arguments, results or reasoning", () => {
    const entries = toEntries([
      { id: "reasoning", type: "reasoning", summary: [{ type: "summary_text", text: "private reasoning" }] },
      { id: "tool", type: "tool_output", status: "in_progress", requestId: "r1", toolCall: { name: "Bash", arguments: JSON.stringify({ command: "echo secret-token", description: "private intent" }) }, output: "private result" },
    ] as never, new Set());
    expect(chatActivity(entries, true, false)).toBe("Using bash…");
    expect(chatActivity([steps(read, { ...read, id: "edit", tool: "edit_file" })], true, false)).toBe("Using edit_file…");
  });

  it("distinguishes waiting and keeps unknown tool names private", () => {
    expect(chatActivity([steps({ ...read, state: "waiting" })], true, false)).toBe("Waiting on readProjectSource…");
    expect(chatActivity([steps({ ...read, tool: "private-token" })], true, false)).toBe("Using a tool…");
    expect(chatActivity([steps({ ...read, tool: "private-token", state: "waiting" })], true, false)).toBe("Waiting on a tool…");
  });

  it("falls back when activity is absent, finished, stale, stopped, or belongs to an earlier turn", () => {
    for (const state of ["completed", "error"] as const) {
      expect(chatActivity([steps({ ...read, state })], true, false)).toBeUndefined();
    }
    expect(chatActivity([], true, false)).toBeUndefined();
    expect(chatActivity([steps(read)], false, false)).toBeUndefined();
    expect(chatActivity([steps(read)], true, true)).toBeUndefined();
    for (const next of [
      { kind: "user", id: "u", text: "new turn" },
      { kind: "assistant", id: "a", text: "answer", streaming: true },
      { kind: "stopped", id: "stop", requestId: "r1" },
      { kind: "failed", id: "fail", requestId: "r1", reason: "failed", retryable: true },
    ] satisfies ConversationEntry[]) {
      expect(chatActivity([steps(read), next], true, false)).toBeUndefined();
    }
  });

  it("updates the answering line while preserving inline tools and hides it when answer text starts", () => {
    const subscribers = new Set<(view: ConversationView) => void>();
    const show = (view: ConversationView) => subscribers.forEach((onChange) => onChange(view));
    let connect: (state: SessionConnectionStatus) => void = () => {};
    const initial: ConversationView = { entries: [steps({ ...read, id: "earlier", state: "completed" }, read)], running: true, stopping: false, backgroundRunning: 0 };
    const quiet = () => () => {};
    const adapter = {
      watchConversation: (_: string, onChange: (view: ConversationView) => void) => { subscribers.add(onChange); onChange(initial); return () => { subscribers.delete(onChange); }; },
      watchConnection: (_: string, onChange: typeof connect) => { connect = onChange; onChange("live"); return () => {}; },
      watchWindow: quiet, watchTalk: quiet, watchTasks: quiet, watchActivity: quiet,
    } as unknown as LabAdapter;
    const worker = { id: "lead", name: "Lead", role: "Coordinates work" };
    const view = render(<Conversation adapter={adapter} worker={worker} sessionId="s1" nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} isCoding={() => false} harnessOf={() => undefined} onFire={async () => {}} onOpen={() => {}} />);
    const line = () => view.container.querySelector("[data-chat-activity]");
    expect(line()?.textContent).toBe("Lead · Using readProjectSource…");
    expect(view.container.querySelector("details")?.open).toBe(true);
    expect(view.container.querySelector("[data-step=tools] li")?.textContent).toContain(read.text);

    act(() => show({ ...initial, entries: [steps({ ...read, state: "waiting" })] }));
    expect(line()?.textContent).toBe("Lead · Waiting on readProjectSource…");
    act(() => connect("lapsed"));
    expect(line()?.textContent).toBe("Lead is answering…");
    expect(line()?.className).toContain(STALE_CLASS);
    act(() => connect("live"));
    expect(line()?.textContent).toBe("Lead · Waiting on readProjectSource…");

    act(() => show({ ...initial, entries: [steps({ ...read, state: "completed" })] }));
    expect(line()?.textContent).toBe("Lead is answering…");
    act(() => show({ ...initial, entries: [...initial.entries, { kind: "assistant", id: "a", text: "The answer", streaming: true }] }));
    expect(line()).toBeNull();
    act(() => show({ ...initial, running: false }));
    expect(line()).toBeNull();
  });
});
