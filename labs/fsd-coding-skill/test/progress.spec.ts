/** Exercises the compact progress filter as a real, incrementally consumed jq process. */
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const filter = fileURLToPath(new URL("../progress.jq", import.meta.url));
const args = ["--unbuffered", "-c", "-f", filter];

function project(events: unknown[]): Record<string, unknown>[] {
  const output = execFileSync("jq", args, {
    input: events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    encoding: "utf8",
  });
  return output.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

describe("coding progress stream", () => {
  it("reports a denied tool while input is still open, without waiting for a terminal event", async () => {
    const child = spawn("jq", args, { stdio: ["pipe", "pipe", "pipe"] });
    let text = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    try {
      const line = new Promise<Record<string, unknown>>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`No live progress: ${stderr}`)), 5_000);
        child.on("error", reject);
        child.on("exit", (code) => reject(new Error(`Exited before live progress: ${code}; ${stderr}`)));
        child.stdout.on("data", (chunk) => {
          text += chunk;
          let newline: number;
          while ((newline = text.indexOf("\n")) !== -1) {
            const event = JSON.parse(text.slice(0, newline));
            text = text.slice(newline + 1);
            if (event.event === "tool_denied") resolve(event);
          }
        });
      });
      child.stdin.write(JSON.stringify({
        type: "item_done",
        item: {
          type: "tool_output", status: "failed",
          toolCall: { name: "Write", callId: "write-1" },
          output: "Claude requested permissions to write, but you haven't granted it yet.",
        },
      }) + "\n");
      expect(await line).toMatchObject({
        event: "tool_denied", name: "Write", id: "write-1",
        detail: "Claude requested permissions to write, but you haven't granted it yet.",
      });
      expect(child.stdin.writableEnded).toBe(false);
      expect(child.exitCode).toBeNull();
    } finally {
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
    }
  });

  it("adds denial signals for failed approval results while preserving tool outcomes", () => {
    const denials = [
      { name: "Write", status: "failed", output: "Claude requested permissions to write, but you haven't granted it yet." },
      { name: "Edit", status: "completed", isError: true, output: { message: "This tool requires approval." } },
      { name: "Bash", status: "completed", output: { isError: true, content: [{ type: "text", text: "The command WAS BLOCKED." }] } },
      { name: "Write", status: "failed", error: { message: "Writing requires approval." } },
    ];
    const lines = project(denials.map(({ name, ...item }, index) => ({
      type: "item_done",
      item: { type: "tool_output", toolCall: { name, callId: `denied-${index}` }, ...item },
    })));

    expect(lines.map((line) => line.event)).toEqual(denials.flatMap(() => ["tool_finished", "tool_denied"]));
    expect(lines.filter((line) => line.event === "tool_finished").map((line) => line.status)).toEqual(denials.map(() => "failed"));
    expect(lines.filter((line) => line.event === "tool_denied")).toEqual([
      { event: "tool_denied", name: "Write", id: "denied-0", detail: denials[0].output },
      { event: "tool_denied", name: "Edit", id: "denied-1", detail: "This tool requires approval." },
      { event: "tool_denied", name: "Bash", id: "denied-2", detail: "The command WAS BLOCKED." },
      { event: "tool_denied", name: "Write", id: "denied-3", detail: "Writing requires approval." },
    ]);
  });

  it("does not flag ordinary failures or successful output that mentions approval", () => {
    const lines = project([
      { type: "item_done", item: { type: "tool_output", status: "failed", output: "No such file or directory" } },
      { type: "item_done", item: { type: "tool_output", status: "completed", output: "The documented operation requires approval." } },
    ]);
    expect(lines).toEqual([
      { event: "tool_finished", name: "tool", id: "", status: "failed", detail: "No such file or directory" },
      { event: "tool_finished", name: "tool", id: "", status: "completed" },
    ]);
  });

  it("detects denials beyond the displayed excerpt without emitting large details", () => {
    const lines = project([{
      type: "item_done",
      item: {
        type: "tool_output", status: "failed",
        toolCall: { name: "Bash", callId: "long-denial" },
        output: "context ".repeat(100) + "This command requires approval.",
      },
    }]);
    expect(lines.map((line) => line.event)).toEqual(["tool_finished", "tool_denied"]);
    expect(lines[1]).toMatchObject({ name: "Bash", id: "long-denial", detail: lines[0].detail });
    expect(String(lines[1].detail).length).toBeLessThanOrEqual(480);
  });

  it("omits token deltas, payloads and duplicate lifecycle snapshots", () => {
    const secretPayload = "DO_NOT_ECHO_".repeat(10_000);
    const message = { type: "message", role: "assistant", content: [{ type: "output_text", text: "Checking the diff." }] };
    const tool = {
      type: "tool_output", status: "in_progress",
      toolCall: { name: "Bash", callId: "check-1", arguments: JSON.stringify({ description: "Check changes", command: secretPayload }) },
    };
    const result = { ...tool, status: "completed", output: secretPayload };
    const lines = project([
      { type: "item_added", item: { type: "block_trace", blockName: "implement", provenance: {}, input: secretPayload } },
      { type: "item_added", item: message },
      ...Array.from({ length: 2_000 }, () => ({ type: "content_delta", delta: secretPayload.slice(0, 30) })),
      { type: "item_done", item: message },
      { type: "item_added", item: tool },
      { type: "item_updated", itemId: "tool-1", patch: result },
      { type: "item_done", item: result },
    ]);
    expect(lines.map((line) => line.event)).toEqual(["started", "message", "tool_started", "tool_finished"]);
    expect(lines[2]).toMatchObject({ name: "Bash", detail: "Check changes" });
    expect(JSON.stringify(lines)).not.toContain("DO_NOT_ECHO_");
  });

  it("bounds large failure details and preserves structured error signals", () => {
    const lines = project([
      { type: "item_done", item: { type: "tool_output", status: "failed", output: "denied ".repeat(20_000) } },
      { type: "item_done", item: { type: "tool_output", status: "completed", output: { isError: true, content: [{ type: "text", text: "Permission denied" }] } } },
      { type: "item_done", item: { type: "tool_output", status: "failed", output: { other: "large ".repeat(20_000) } } },
    ]);
    expect(lines.every((line) => line.status === "failed")).toBe(true);
    expect(lines[0].detail).toMatch(/^denied /);
    expect(String(lines[0].detail).length).toBeLessThanOrEqual(480);
    expect(lines[1].detail).toBe("Permission denied");
    expect(lines[2].detail).toBe("[structured result]");
    expect(JSON.stringify(lines).length).toBeLessThan(1_000);
  });

  it("reports terminal claims without treating a finished agent turn as verified success", () => {
    const lines = project([
      { type: "item_added", item: { type: "status", message: "Agent started" } },
      { type: "item_done", item: { type: "status", message: "Agent started" } },
      { type: "flow_complete", durationMs: 100, items: 2, output: { outcome: "finished", finalMessage: "Blocked: no files changed.", privatePayload: "not progress" } },
      { type: "error", message: "Execution failed" },
    ]);
    expect(lines).toEqual([
      { event: "status", text: "Agent started" },
      { event: "finished", durationMs: 100, items: 2, outcome: "finished", claim: "Blocked: no files changed." },
      { event: "error", text: "Execution failed" },
    ]);
  });
});
