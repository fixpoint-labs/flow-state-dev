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

const target: FlowActionTarget = { flowKind: "hello-chat", actionName: "chat" };

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

  it("prints a persistent (non-transient) status as its own line", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    r.onEvent(added({ id: "s1", type: "status", message: "Request was stopped." }));
    r.onTurnEnd({ success: false, durationMs: 3, aborted: true });
    expect(text()).toBe("· status: Request was stopped.\n(interrupted)\n");
  });

  it("never prints a blank-message status, transient or not", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream, { isTTY: true });
    r.onEvent(added({ id: "s1", type: "status", message: "", transient: true }));
    r.onEvent(added({ id: "s2", type: "status", message: "", transient: false }));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    expect(text()).toBe("");
  });

  it("suppresses transient in-flight status pings entirely outside a TTY", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream); // isTTY defaults to false
    r.onEvent(added({ id: "s1", type: "status", message: "Running search-web...", transient: true }));
    r.onEvent(added({ id: "s2", type: "status", message: "Synthesizing findings...", transient: true }));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    expect(text()).toBe("");
  });

  it("redraws a single live status line for transient pings in a TTY, never accumulating", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream, { isTTY: true });
    r.onEvent(added({ id: "s1", type: "status", message: "Running search-web...", transient: true }));
    r.onEvent(added({ id: "s2", type: "status", message: "Synthesizing findings...", transient: true }));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    // Second ping clears the first (\r + spaces the width of the first + \r) before
    // writing itself; turn end clears the second the same way. No line ever prints.
    expect(text()).toBe(
      "Running search-web..." +
      `\r${" ".repeat("Running search-web...".length)}\r` +
      "Synthesizing findings..." +
      `\r${" ".repeat("Synthesizing findings...".length)}\r`
    );
    expect(text()).not.toContain("· status:");
  });

  it("clears a live status line before real content prints, so they never interleave", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream, { isTTY: true });
    r.onEvent(added({ id: "s1", type: "status", message: "Thinking...", transient: true }));
    r.onEvent(added({ id: "m1", type: "message", role: "assistant", content: [] }));
    r.onEvent(delta("m1", "Hi!"));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    expect(text()).toBe(
      "Thinking..." + `\r${" ".repeat("Thinking...".length)}\r` + "Hi!\n"
    );
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

  it("prints a distinct line when a tool settles in failure", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    const tool = { id: "t1", type: "tool_output", blockName: "search", toolCall: { callId: "c1", name: "search-web" }, output: null };
    r.onEvent(added(tool));
    r.onEvent(done({ ...tool, error: { message: "upstream 503" } }));
    r.onTurnEnd({ success: false, durationMs: 4, aborted: false });
    expect(text()).toBe("· tool call: search-web\n· tool failed: search-web — upstream 503\n");
  });

  it("prints nothing extra when a tool settles successfully", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    const tool = { id: "t1", type: "tool_output", blockName: "search", toolCall: { callId: "c1", name: "search-web" }, output: { hits: 3 } };
    r.onEvent(added(tool));
    r.onEvent(done(tool));
    r.onTurnEnd({ success: true, durationMs: 4, aborted: false });
    // The start line only — and no dump of the tool's output.
    expect(text()).toBe("· tool call: search-web\n");
  });

  it("reports a refused tool call that carries status failed and no error", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    const tool = { id: "t1", type: "tool_output", blockName: "Bash", toolCall: { callId: "toolu_01", name: "Bash" }, output: null };
    r.onEvent(added(tool));
    // The shape a denied/refused tool call settles in: status "failed", the
    // refusal text in `output`, and no `error` property at all.
    r.onEvent(done({
      ...tool,
      status: "failed",
      output: "This command requires approval",
    }));
    r.onTurnEnd({ success: true, durationMs: 4, aborted: false });
    // Reported as a failure...
    expect(text()).toContain("· tool failed: Bash");
    // ...without dumping the raw tool output.
    expect(text()).not.toContain("This command requires approval");
  });

  it("prefers a structured error message over the generic fallback", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    const tool = { id: "t1", type: "tool_output", blockName: "Bash", toolCall: { callId: "toolu_02", name: "Bash" }, output: null };
    r.onEvent(added(tool));
    r.onEvent(done({ ...tool, status: "failed", error: { message: "This command requires approval" } }));
    r.onTurnEnd({ success: true, durationMs: 4, aborted: false });
    expect(text()).toContain("· tool failed: Bash — This command requires approval");
  });

  it("collapses a multiline tool-failure message to one bounded line", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    const script = `node -e '\nconst fs=require("fs");\nfor (const f of fs.readdirSync(dir)) {\n  console.log(f);\n}\n'`;
    const tool = { id: "t1", type: "tool_output", blockName: "Bash", toolCall: { callId: "c1", name: "Bash" }, output: null };
    r.onEvent(added(tool));
    r.onEvent(done({ ...tool, status: "failed", error: { message: `This command requires approval: ${script}` } }));
    r.onTurnEnd({ success: false, durationMs: 2, aborted: false });

    const lines = text().split("\n").filter((l) => l.length > 0);
    const failure = lines.find((l) => l.startsWith("· tool failed:"))!;
    expect(failure).toBeDefined();
    // One physical line — the embedded script's newlines are gone.
    expect(failure).not.toContain("\n");
    expect(lines).toHaveLength(2); // the start line and the failure line, nothing else
    expect(failure).toContain("This command requires approval");
  });

  it("bounds a very long progress message and marks the truncation", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream, { transientStatus: "lines" });
    r.onEvent(added({ id: "s1", type: "status", message: "x".repeat(5000), transient: true }));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });

    const line = text().trimEnd();
    expect(line.length).toBeLessThan(300);
    expect(line).toContain("… (truncated)");
  });

  it("leaves assistant prose untouched, however long or multiline", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    const prose = `${"a".repeat(1000)}\n\nsecond paragraph`;
    r.onEvent(added({ id: "m1", type: "message", role: "assistant", content: [] }));
    r.onEvent(done({ id: "m1", type: "message", role: "assistant", content: [{ type: "output_text", text: prose }] }));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    expect(text()).toBe(`${prose}\n`);
  });

  it("leaves system lines untouched", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    const help = `Commands:\n  /use <flow>\n  /exit`;
    r.onSystem(help);
    expect(text()).toBe(`${help}\n`);
  });

  it("does not stream deltas for a user-role message item", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    // A user echo is also type "message"; only the role tells it apart.
    r.onEvent(added({ id: "u1", type: "message", role: "user", content: [] }));
    r.onEvent(delta("u1", "my secret prompt"));
    r.onEvent(done({ id: "u1", type: "message", role: "user", content: [{ type: "output_text", text: "my secret prompt" }] }));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    expect(text()).toBe("");
  });

  it("does not report a suspended tool as a failure", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream);
    const tool = { id: "t1", type: "tool_output", blockName: "gate", toolCall: { callId: "c1", name: "await-approval" }, output: null };
    r.onEvent(added(tool));
    // ctx.suspend() settles the item as failed with a SUSPENSION code; it will
    // re-enter its gate on resume and must not read as an error — the code wins
    // over the failed status.
    r.onEvent(done({ ...tool, status: "failed", error: { message: "suspended", code: "SUSPENSION" } }));
    r.onTurnEnd({ success: true, durationMs: 4, aborted: false });
    expect(text()).toBe("· tool call: await-approval\n");
  });

  it("prints transient status pings as lines outside a TTY under transientStatus: lines", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream, { transientStatus: "lines" });
    r.onEvent(added({ id: "s1", type: "status", message: "Running search-web...", transient: true }));
    r.onEvent(added({ id: "s2", type: "status", message: "Synthesizing findings...", transient: true }));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    // Both pings visible, and no ANSI redraw sequences in a piped log.
    expect(text()).toBe("· status: Running search-web...\n· status: Synthesizing findings...\n");
    expect(text()).not.toContain("\r");
  });

  it("still suppresses a blank transient status under transientStatus: lines", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream, { transientStatus: "lines" });
    r.onEvent(added({ id: "s1", type: "status", message: "", transient: true }));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    expect(text()).toBe("");
  });

  it("closes a mid-stream assistant line before a transient status line", () => {
    const { stream, text } = sink();
    const r = createPlainTextRenderer(stream, { transientStatus: "lines" });
    r.onEvent(added({ id: "m1", type: "message", role: "assistant", content: [] }));
    r.onEvent(delta("m1", "working on it"));
    r.onEvent(added({ id: "s1", type: "status", message: "Compiling...", transient: true }));
    r.onTurnEnd({ success: true, durationMs: 1, aborted: false });
    expect(text()).toBe("working on it\n· status: Compiling...\n");
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
