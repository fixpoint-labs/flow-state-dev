// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionConnectionStatus } from "@flow-state-dev/client";
import type { ItemLine } from "@flow-state-dev/react";
import type { ConversationView } from "../src/lib/conversation";
import { call, failure, linesOf, message, parked } from "./lines";
import { Conversation } from "../src/components/Conversation";
import { rosterEntry } from "./scripted-server";
import { standInFollower, TestProvider } from "./stub-server";
import { STALE_CLASS } from "../src/components/flow-state/connection-banner";
import { answeringStep } from "../src/lib/status";
import { lookOf } from "../src/lib/looks";

afterEach(cleanup);

/** A turn's calls, as its one steps line. */
const steps = (...items: object[]): ItemLine[] => linesOf(items);
const read = call("read", "r1", "readProjectSource", { path: "private file contents and arguments" }, "in_progress");

// The answering line's words alone.
const said = (lines: ItemLine[]) => answeringStep(lines)?.text;

describe("the answering line's step", () => {
  it("says what the latest step under way does, in the registry's words, never its text, arguments, results or reasoning", () => {
    const lines = linesOf([
      { id: "reasoning", type: "reasoning", status: "completed", requestId: "r1", summary: [{ type: "summary_text", text: "private reasoning" }] },
      call("tool", "r1", "Bash", { command: "echo secret-token", description: "private intent" }, "in_progress", "private result"),
    ]);
    expect(said(lines)).toBe("running a command");
    // The latest step under way wins over an earlier one still running.
    expect(said(steps(read, call("edit", "r1", "edit_file", {}, "in_progress")))).toBe("editing a file");
    // Claude Code's capitalised name resolves to the same entry.
    expect(said(steps(call("bash", "r1", "Bash", {}, "in_progress")))).toBe("running a command");
  });

  it("says a call parked on you waits on you, in the attention tone, and keeps unknown tool names private", () => {
    expect(answeringStep(steps(parked("read", "r1", "readProjectSource")))).toEqual({ text: "waiting on you", tone: "text-attention", needsYou: true });
    expect(said(steps(call("x", "r1", "private-token", {}, "in_progress")))).toBe("using a tool");
  });

  it("says nothing when no step is under way, or the tail belongs to a later entry", () => {
    for (const state of ["completed", "failed"] as const) {
      expect(said(steps({ ...read, status: state }))).toBeUndefined();
    }
    // A call still marked running in a turn that is over never finished.
    expect(said(linesOf([read], [{ id: "r1", status: "failed" }]))).toBeUndefined();
    expect(said([])).toBeUndefined();
    expect(said(linesOf([read, message("u", "r2", "user", "new turn")]))).toBeUndefined();
    expect(said(linesOf([read, message("a", "r1", "assistant", "answer", "in_progress")]))).toBeUndefined();
    expect(said(linesOf([read], [{ id: "r1", status: "aborted" }]))).toBeUndefined();
    expect(said(linesOf([read, failure("fail", "r1", "failed")]))).toBeUndefined();
  });

  it("updates the answering line while preserving inline tools and hides it when answer text starts", () => {
    const earlier = call("earlier", "r1", "readProjectSource", { path: "an earlier file" });
    const initial: ConversationView = { lines: steps(earlier, read), running: true, stopping: false, backgroundRunning: 0 };
    const { Follower, show, connect } = standInFollower("s1", initial);
    const worker = rosterEntry({ id: "lead", name: "Lead", description: "Coordinates work" });
    const view = render(<TestProvider><Follower /><Conversation worker={worker} sessionId="s1" nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} isCoding={() => false} harnessOf={() => undefined} onFire={async () => {}} onOpen={() => {}} /></TestProvider>);
    const line = () => view.container.querySelector("[data-chat-activity]");
    expect(line()?.textContent).toBe("Lead · reading a file…");
    expect(view.container.querySelector("details")?.open).toBe(true);
    expect(view.container.querySelector("[data-step=tools] li")?.textContent).toContain("Read");

    act(() => show({ ...initial, lines: steps(parked("read", "r1", "readProjectSource")) }));
    expect(line()?.textContent).toBe("Lead · waiting on you…");
    expect(line()?.className).toContain("text-attention");
    act(() => connect("lapsed"));
    expect(line()?.textContent).toBe("Lead is answering…");
    expect(line()?.className).toContain(STALE_CLASS);
    act(() => connect("live"));
    expect(line()?.textContent).toBe("Lead · waiting on you…");

    act(() => show({ ...initial, lines: steps({ ...read, status: "completed" }) }));
    expect(line()?.textContent).toBe("Lead is answering…");
    act(() => show({ ...initial, lines: linesOf([earlier, read, message("a", "r1", "assistant", "The answer", "in_progress")]) }));
    expect(line()).toBeNull();
    act(() => show({ ...initial, running: false }));
    expect(line()).toBeNull();
  });
});

// A wait that isn't for your yes draws nothing here (the task popup shows it), so it can't stand in for what is on screen.
describe("a line the conversation draws as nothing", () => {
  const waitOnTask = { id: "w1", requestId: "r1", status: "completed", itemIndex: 0, ts: 0, provenance: { blockName: "worker", blockInstanceId: "worker", phase: "main" }, type: "suspension", reason: "task_hold", suspensionId: "s1", message: "waits on a task" };
  const worker = rosterEntry({ id: "lead", name: "Lead", description: "Coordinates work" });
  const shown = (initial: ConversationView) => {
    const { Follower } = standInFollower("s1", initial);
    return render(<TestProvider><Follower /><Conversation worker={worker} sessionId="s1" nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} isCoding={() => false} harnessOf={() => undefined} onFire={async () => {}} onOpen={() => {}} /></TestProvider>);
  };

  it("doesn't bring the answering line back after an answer already on screen", () => {
    const view = shown({ lines: linesOf([message("a", "r1", "assistant", "The answer", "in_progress"), waitOnTask]), running: true, stopping: false, backgroundRunning: 0 });
    expect(view.container.querySelector("[data-chat-activity]")).toBeNull();
  });

  it("leaves a conversation with nothing drawn empty, with its starter lines", () => {
    const view = shown({ lines: linesOf([waitOnTask]), running: false, stopping: false, backgroundRunning: 0 });
    expect(view.getByRole("list", { name: "Starter lines" })).toBeTruthy();
  });
});
