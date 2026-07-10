import { describe, expect, it } from "vitest";
import { createPlainTextRenderer } from "../src/chat/render";
import type { RequestStreamEventWithId } from "@flow-state-dev/engine";
import type { FlowActionTarget } from "../src/chat/targets";

/** Collects everything written, so assertions run against the full transcript. */
function sink() {
  let buf = "";
  const stream = { write: (chunk: string) => ((buf += chunk), true) } as unknown as NodeJS.WritableStream;
  return { stream, text: () => buf };
}

const target: FlowActionTarget = { kind: "flow-action", flowKind: "hello-chat", actionName: "chat" };

// Minimal event builders — only the fields the renderer reads.
const added = (item: unknown): RequestStreamEventWithId => ({ type: "item.added", item } as any);
const done = (item: unknown): RequestStreamEventWithId => ({ type: "item.done", item } as any);
const delta = (itemId: string, text: string): RequestStreamEventWithId =>
  ({ type: "content.delta", itemId, contentIndex: 0, delta: text } as any);

describe("createPlainTextRenderer", () => {
  it("streams assistant message text verbatim from content.delta", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    r.onTurnStart(target);
    r.onEvent(added({ id: "m1", type: "message", role: "assistant", content: [] }));
    r.onEvent(delta("m1", "Hello, "));
    r.onEvent(delta("m1", "Ada."));
    r.onTurnEnd({ success: true, durationMs: 5, aborted: false });
    expect(text()).toBe("Hello, Ada.\n");
  });

  it("does not stream reasoning content", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    r.onEvent(added({ id: "r1", type: "reasoning", content: [] }));
    r.onEvent(delta("r1", "thinking hard"));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    expect(text()).toBe("");
  });

  it("suppresses the user-message echo", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    r.onEvent(added({ id: "u1", type: "message", role: "user", content: [] }));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    expect(text()).toBe("");
  });

  it("prints a one-liner for a tool call and closes any streamed line first", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    r.onEvent(added({ id: "m1", type: "message", role: "assistant", content: [] }));
    r.onEvent(delta("m1", "let me search"));
    r.onEvent(added({ id: "t1", type: "tool_output", blockName: "search", toolCall: { callId: "c1", name: "search-web" }, output: null }));
    r.onTurnEnd({ success: true, durationMs: 9, aborted: false });
    expect(text()).toBe("let me search\n· tool call: search-web\n");
  });

  it("prints a status one-liner", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    r.onEvent(added({ id: "s1", type: "status", message: "Request was stopped." }));
    r.onTurnEnd({ success: false, durationMs: 3, aborted: true });
    expect(text()).toBe("· status: Request was stopped.\n(interrupted)\n");
  });

  it("prints system lines on their own line, closing a mid-stream line", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    r.onEvent(added({ id: "m1", type: "message", role: "assistant", content: [] }));
    r.onEvent(delta("m1", "partial"));
    r.onSystem("No default target — pick one with /use <flow>.");
    expect(text()).toBe("partial\nNo default target — pick one with /use <flow>.\n");
  });

  it("does not re-print streamed assistant text when item.done arrives", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    r.onEvent(added({ id: "m1", type: "message", role: "assistant", content: [] }));
    r.onEvent(delta("m1", "reply 0"));
    // Final item.done carries the full content; must not double-print it.
    r.onEvent(done({ id: "m1", type: "message", role: "assistant", content: [{ type: "output_text", text: "reply 0" }] }));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    expect(text()).toBe("reply 0\n");
  });

  it("prints assistant text from item.done when a non-streaming provider sends no deltas", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    r.onEvent(added({ id: "m1", type: "message", role: "assistant", content: [] }));
    r.onEvent(done({ id: "m1", type: "message", role: "assistant", content: [{ type: "output_text", text: "whole reply" }] }));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    expect(text()).toBe("whole reply\n");
  });

  it("clears item tracking between turns so a stale id does not stream", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    r.onEvent(added({ id: "m1", type: "message", role: "assistant", content: [] }));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    // Same id, new turn, but item.added not replayed → not treated as a message.
    r.onEvent(delta("m1", "leak?"));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    expect(text()).toBe("");
  });
});
