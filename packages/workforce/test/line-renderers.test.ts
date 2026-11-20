// @vitest-environment happy-dom
// FIX-2848 D1.
/**
 * `workforceRenderers`: how workforce's conversation lines look by default,
 * drawn the way an app draws a conversation, through React's model and
 * `ItemsRenderer` with the renderers spread into the registry's `data` slot.
 *
 * Why it matters: an app gets a message received or sent, a task filed and a
 * task's ending on its screen by spreading these, without decoding a tool call
 * or the board's ending line itself. The control holds the other half: with
 * the renderers left out, none of those lines draws, and the `sendMessage`
 * call that wrote a sent line doesn't come back as a step in its place.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import type { DataItem, OutputItem, ToolOutputItem } from "@flow-state-dev/core/items";
import { conversationLines, FlowProvider, ItemsRenderer, type RendererRegistry } from "@flow-state-dev/react";
import { workforceRenderers } from "../src/react";
import { FILED_TASK_DATA_TYPE, RECEIVED_MESSAGE_DATA_TYPE, SENT_MESSAGE_DATA_TYPE, TASK_RESULT_DATA_TYPE } from "../src/messages/keys";
import type { FiledTaskValue, ReceivedMessageValue, SentMessageValue, TaskResultValue } from "../src/messages/line-values";

afterEach(cleanup);

const base = (id: string) => ({ id, requestId: "r1", itemIndex: 0, ts: 0, status: "completed" as const, provenance: { blockName: "gen", blockInstanceId: "r1:root:0", phase: "main" as const } });

/** A data item written inside the `sendMessage` call `callId`, keyed by that call, as the tool writes it. */
function sentIn(id: string, callId: string, value: SentMessageValue): DataItem {
  const path = `root/step[0]/tool[sendMessage][${callId}]`;
  return { ...base(id), type: "data", dataType: SENT_MESSAGE_DATA_TYPE, value, key: `r1:${path}`, provenance: { blockName: "sendMessage", blockInstanceId: `r1:${path}:0`, phase: "main" } } as DataItem;
}
const line = (id: string, dataType: string, value: unknown): DataItem => ({ ...base(id), type: "data", dataType, value }) as DataItem;
const sendCall = (id: string, callId: string): ToolOutputItem =>
  ({ ...base(id), type: "tool_output", blockName: "gen", output: { sent: "msg_1" }, toolCall: { callId, name: "sendMessage", arguments: "{}", generatorBlock: "gen" } }) as ToolOutputItem;

const items: OutputItem[] = [
  line("in", RECEIVED_MESSAGE_DATA_TYPE, { id: "msg_0", from: "ada", text: "Can you check the build?", budget: 3, replyRequested: true } satisfies ReceivedMessageValue),
  sendCall("c1", "tc_A"),
  sentIn("out", "tc_A", { to: "ada", text: "On it.", messageId: "msg_1" }),
  sendCall("c2", "tc_B"),
  sentIn("asked", "tc_B", { to: "bo", text: "Codename?", messageId: "msg_2", wait: { status: "answered", reply: "Bluebird." } }),
  sendCall("c3", "tc_C"),
  sentIn("refused", "tc_C", { to: "nobody", text: "Anyone?", refused: "no_worker: nobody is not on your roster." }),
  line("filed", FILED_TASK_DATA_TYPE, { taskId: "task_1", title: "Fix the build", assignee: "eng.tasker" } satisfies FiledTaskValue),
  line("done", TASK_RESULT_DATA_TYPE, { taskId: "task_1", from: "eng.tasker", title: "Fix the build", text: "Green again.", ending: "completed" } satisfies TaskResultValue)
];

/** The conversation as an app draws it, with `renderers` in the registry. */
function draw(renderers: RendererRegistry) {
  const lines = conversationLines(items, [{ id: "r1", status: "completed" }], { renderers });
  return render(createElement(FlowProvider, { renderers }, createElement(ItemsRenderer, { lines })));
}

describe("workforce's line renderers", () => {
  it("draw a message received, each send (asked, answered, refused), a task filed and its ending", () => {
    const { container } = draw({ data: { ...workforceRenderers } });
    const drawn = [...container.querySelectorAll("[data-line]")].map((node) => [node.getAttribute("data-line"), node.textContent]);
    expect(drawn).toEqual([
      ["received", "From ada: Can you check the build?asks for a reply"],
      ["sent", "To ada: On it."],
      ["sent", "Asked bo: Codename?Bluebird."],
      ["sent", "Not sent to nobody: Anyone?no_worker: nobody is not on your roster."],
      ["task", "Filed a task for eng.tasker: Fix the build"],
      ["result", "eng.tasker finished: Fix the buildGreen again."]
    ]);
    expect(container.querySelector('[data-line="sent"][data-state="refused"]')).not.toBeNull();
  });

  it("are the only way those lines show: without them none draws, and the sends' calls don't come back as steps", () => {
    const { container } = draw({});
    expect(container.querySelectorAll("[data-line]")).toHaveLength(0);
    expect(container.textContent).toBe("");
  });

  it("give way to an app's own renderer for a type, spread after them", () => {
    const Mine = () => createElement("p", { "data-line": "mine" }, "mine");
    const { container } = draw({ data: { ...workforceRenderers, [TASK_RESULT_DATA_TYPE]: Mine } });
    expect(container.querySelectorAll('[data-line="result"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-line="mine"]')).toHaveLength(1);
  });
});
