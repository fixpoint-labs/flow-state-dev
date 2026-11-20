// @vitest-environment happy-dom
/**
 * Workforce's conversation lines as an app configures them: a message
 * received or sent, a task filed, a task's ending, and a task's brief folded,
 * drawn the way an app draws a conversation (React's model and
 * `ItemsRenderer`, the renderers spread into the registry's `data` slot).
 *
 * Why it matters: an app gets these lines by spreading them and saying, in
 * its line context, whose names and pictures to show and what a click opens.
 * Without that context the same lines draw and open nothing; without the
 * renderers none of them draws, and the sends' calls don't come back as steps.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DataItem, MessageItem, OutputItem, ToolOutputItem } from "@flow-state-dev/core/items";
import { conversationLines, FlowProvider, ItemsRenderer, type RendererRegistry } from "@flow-state-dev/react";
import {
  FILED_TASK_DATA_TYPE,
  RECEIVED_MESSAGE_DATA_TYPE,
  SENT_MESSAGE_DATA_TYPE,
  TASK_RESULT_DATA_TYPE,
  taskBriefMetadata,
  type FiledTaskValue,
  type ReceivedMessageValue,
  type SentMessageValue,
  type TaskResultValue,
} from "@flow-state-dev/workforce/browser";
import { LineContext, type LineContextValue } from "../../registry/components/conversation-lines";
import { isTaskBrief, withBrief, workforceLineRenderers } from "../../registry/components/workforce-lines";

afterEach(cleanup);

const base = (id: string) => ({ id, requestId: "r1", itemIndex: 0, ts: 0, status: "completed" as const, provenance: { blockName: "gen", blockInstanceId: "r1:root:0", phase: "main" as const } });

/** A data item written inside the `sendMessage` call `callId`, keyed by that call, as the tool writes it. */
function sentIn(id: string, callId: string, value: SentMessageValue): DataItem {
  const path = `root/step[0]/tool[sendMessage][${callId}]`;
  return { ...base(id), type: "data", dataType: SENT_MESSAGE_DATA_TYPE, value, key: `r1:${path}`, provenance: { blockName: "sendMessage", blockInstanceId: `r1:${path}:0`, phase: "main" } } as DataItem;
}
const line = (id: string, dataType: string, value: unknown): DataItem => ({ ...base(id), type: "data", dataType, value }) as DataItem;
/** The `sendMessage` call `callId`, as its generator (at `root/step[0]`) records it. */
const sendCall = (id: string, callId: string): ToolOutputItem =>
  ({ ...base(id), provenance: { blockName: "gen", blockInstanceId: "r1:root/step[0]:0", phase: "main" as const }, type: "tool_output", blockName: "gen", output: { sent: "msg_1" }, toolCall: { callId, name: "sendMessage", arguments: "{}", generatorBlock: "gen" } }) as ToolOutputItem;

const items: OutputItem[] = [
  line("in", RECEIVED_MESSAGE_DATA_TYPE, { id: "msg_0", from: "ada", text: "Can you check the build?", budget: 3, replyRequested: true } satisfies ReceivedMessageValue),
  sendCall("c1", "tc_A"),
  sentIn("out", "tc_A", { to: "ada", text: "On it.", messageId: "msg_1" }),
  sendCall("c2", "tc_B"),
  sentIn("asked", "tc_B", { to: "bo", text: "Codename?", messageId: "msg_2", wait: { status: "answered", reply: "Bluebird." } }),
  sendCall("c3", "tc_C"),
  sentIn("refused", "tc_C", { to: "nobody", text: "Anyone?", refused: "no_worker: nobody is not on your roster." }),
  line("filed", FILED_TASK_DATA_TYPE, { taskId: "task_1", title: "Fix the build", assignee: "eng.tasker" } satisfies FiledTaskValue),
  line("done", TASK_RESULT_DATA_TYPE, { taskId: "task_1", from: "eng.tasker", title: "Fix the build", text: "Green again.", ending: "completed" } satisfies TaskResultValue),
];

const registry: RendererRegistry = { data: { ...workforceLineRenderers } };

/** The conversation as an app draws it, with `renderers` in the registry, on a screen with `screenOf`'s context. */
function draw(drawn: readonly OutputItem[] = items, screenOf?: LineContextValue, renderers: RendererRegistry = registry) {
  const lines = conversationLines([...drawn], [{ id: "r1", status: "completed" }], { renderers });
  const body = <ItemsRenderer lines={lines} />;
  return render(<FlowProvider renderers={renderers}>{screenOf === undefined ? body : <LineContext.Provider value={screenOf}>{body}</LineContext.Provider>}</FlowProvider>);
}

const linesOf = (container: HTMLElement) => [...container.querySelectorAll("[data-line]")].map((node) => node.getAttribute("data-line"));

describe("workforce's lines", () => {
  it("draw a message received, each send (sent, answered, refused), a task filed and its ending, by name", () => {
    const { container } = draw(items, { nameOf: (id) => id.toUpperCase() });
    expect(linesOf(container)).toEqual(["received", "sent", "sent", "sent", "task", "result"]);
    expect(screen.getByRole("region", { name: "From ADA" }).textContent).toContain("Can you check the build?");
    expect(container.querySelector('[data-line="received"]')!.textContent).toContain("asks for a reply");
    expect(container.querySelector('[data-message-id="msg_1"]')!.textContent).toContain("Messaged ADA");
    const asked = container.querySelector('[data-message-id="msg_2"]')!;
    expect(asked.textContent).toContain("Asked BO");
    expect(asked.querySelector("[data-part=answer]")!.textContent).toBe("Bluebird.");
    const refused = container.querySelector('[data-line="sent"][data-state="refused"]')!;
    expect(refused.textContent).toContain("Not sent to NOBODY: Anyone?");
    expect(refused.textContent).toContain("no_worker: nobody is not on your roster.");
    expect(container.querySelector('[data-line="task"]')!.textContent).toContain("Filed a task for ENG.TASKER: Fix the build");
    expect(container.querySelector('[data-line="result"]')!.getAttribute("data-status")).toBe("done");
    expect(container.querySelector('[data-line="result"]')!.textContent).toContain("ENG.TASKER finished: Fix the build");
  });

  it("open what the screen says a click opens: a sent message's exchange, a task", () => {
    const opened: unknown[] = [];
    draw(items, { openMessage: (sent) => void opened.push(sent), openTask: (id) => void opened.push(id), avatarOf: (id) => <i data-avatar={id} /> });
    fireEvent.click(screen.getByRole("button", { name: "Messaged ada: On it." }));
    fireEvent.click(screen.getByRole("button", { name: "eng.tasker finished: Fix the build" }));
    fireEvent.click(screen.getByRole("button", { name: "Filed a task for eng.tasker: Fix the build" }));
    expect(opened).toEqual([{ to: "ada", messageId: "msg_1", text: "On it." }, "task_1", "task_1"]);
    // Each line about a worker carries that worker's picture.
    expect([...document.querySelectorAll("[data-avatar]")].map((a) => a.getAttribute("data-avatar"))).toEqual(["ada", "ada", "bo", "nobody", "eng.tasker", "eng.tasker"]);
  });

  it("show how a sent message stands, when the screen knows", () => {
    draw(items, { sentStatusOf: (id) => (id === "msg_1" ? "replied" : undefined) });
    expect(document.querySelector('[data-message-id="msg_1"] [data-sent-status]')!.textContent).toBe("replied");
  });

  // A popup shows the same lines with nowhere to go.
  it("open nothing outside a screen's context, and refused or task-addressed sends never open", () => {
    draw(items);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    cleanup();
    draw([sentIn("t", "tc_T", { to: { task: "task_42" }, text: "Done yet?", messageId: "msg_9" })], { openMessage: () => undefined });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.querySelector('[data-line="sent"]')!.textContent).toContain("Messaged task task_42: Done yet?");
  });

  // Only a waited send is asked here: a reply asked for comes later as a message of its own, so nothing is drawn under the line.
  it("say a send that asks for a reply messaged, with no answer under it", () => {
    draw([sentIn("q", "tc_Q", { to: "pm", text: "The plan?", messageId: "msg_8", replyRequested: true })]);
    const line = document.querySelector('[data-line="sent"]')!;
    expect(line.textContent).toContain("Messaged pm: The plan?");
    expect(line.querySelector("[data-part=answer]")).toBeNull();
  });

  it("draw a waited send whose delivery failed as failed, with why, not as sent", () => {
    const failed = sentIn("lost", "tc_D", { to: "cy", text: "Ping?", messageId: "msg_3", wait: { status: "failed", error: "undeliverable: cy's session is gone." } });
    const { container } = draw([sendCall("c4", "tc_D"), failed]);
    const drawn = container.querySelector('[data-line="sent"]')!;
    expect(drawn.getAttribute("data-state")).toBe("failed");
    expect(drawn.textContent).toContain("Not answered by cy: Ping?");
    expect(drawn.textContent).toContain("undeliverable: cy's session is gone.");
  });

  it("say a task that errored couldn't finish, and a cancelled one was cancelled, never failed", () => {
    draw([
      line("a", TASK_RESULT_DATA_TYPE, { taskId: "x", from: "cy", title: "Fix it", text: "…", ending: "errored" }),
      line("b", TASK_RESULT_DATA_TYPE, { taskId: "y", title: "Tidy", text: "…", ending: "cancelled" }),
    ]);
    const [errored, cancelled] = [...document.querySelectorAll('[data-line="result"]')];
    expect([errored!.getAttribute("data-status"), cancelled!.getAttribute("data-status")]).toEqual(["failed", "cancelled"]);
    expect(errored!.textContent).toContain("cy couldn't finish: Fix it");
    expect(cancelled!.textContent).toContain("The task was cancelled: Tidy");
  });

  it("are the only way those lines show: without them none draws, and the sends' calls don't come back as steps", () => {
    const { container } = draw(items, undefined, {});
    expect(container.querySelectorAll("[data-line]")).toHaveLength(0);
    expect(container.textContent).toBe("");
  });
});

describe("a task's brief", () => {
  const brief = { ...base("b1"), type: "message", role: "user", content: [{ type: "input_text", text: "Fix the flaky test." }], metadata: taskBriefMetadata({ taskId: "task_1" }) } as unknown as MessageItem;
  const said = { ...base("u1"), type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] } as unknown as MessageItem;
  const Mine = ({ item }: { item: MessageItem }) => <p data-mine>{(item.content[0] as { text: string }).text}</p>;

  // The words a worker was handed are not words the user typed.
  it("folds to one line that opens to the brief, drawn by the app's own message look", () => {
    expect(isTaskBrief(brief)).toBe(true);
    expect(isTaskBrief(said)).toBe(false);
    const renderers: RendererRegistry = { message: withBrief(Mine) };
    draw([brief, said], undefined, renderers);
    const fold = document.querySelector('[data-line="brief"]')!;
    expect(within(fold as HTMLElement).getByRole("button").textContent).toBe("Task brief");
    expect(fold.querySelector("[data-mine]")).toBeNull();
    fireEvent.click(within(fold as HTMLElement).getByRole("button"));
    expect(fold.querySelector("[data-mine]")!.textContent).toBe("Fix the flaky test.");
    // Every other message is the app's own, unfolded.
    expect([...document.querySelectorAll("[data-mine]")].map((p) => p.textContent)).toEqual(["Fix the flaky test.", "Hello"]);
  });
});
