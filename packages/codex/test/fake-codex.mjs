#!/usr/bin/env node
/**
 * A stand-in `codex` binary for the wire-pinning spec.
 *
 * Records the argv and stdin the installed SDK hands it, then speaks the JSONL
 * that `codex exec --experimental-json` speaks. This is the graduated form of
 * the spec POC's fake (`spec-poc/LAB-153-codex-sdk-shape/fake-codex.sh`), in
 * Node rather than bash so it runs wherever the test suite does.
 *
 * `FAKE_CODEX_MODE` steers the ending: ok (default) · hang · fail · crash.
 */
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

const log = process.env.FAKE_CODEX_LOG;
const argv = process.argv.slice(2);
if (log) appendFileSync(log, `ARGV: ${argv.join(" ")}\n`);

let stdin = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) stdin += chunk;
if (log) appendFileSync(log, `STDIN: ${stdin}\n`);
if (log) appendFileSync(log, `ENV CODEX_API_KEY=${process.env.CODEX_API_KEY ?? "<unset>"}\n`);

const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

// `resume <id>` → the thread id is the one being resumed, as the real CLI does.
const resumeAt = argv.indexOf("resume");
const threadId = resumeAt >= 0 ? argv[resumeAt + 1] : (process.env.FAKE_CODEX_THREAD_ID ?? "thr_fake_1");

say({ type: "thread.started", thread_id: threadId });
say({ type: "turn.started" });

switch (process.env.FAKE_CODEX_MODE ?? "ok") {
  case "hang": {
    say({
      type: "item.started",
      item: { id: "item_1", type: "command_execution", command: "sleep", aggregated_output: "", status: "in_progress" },
    });
    // A GRANDCHILD holding our stdout open. This is the POC's finding in
    // executable form: killing the CLI does not close the pipe, so an SDK
    // rejection that waits on stdout waits for the grandchild — which is why
    // the block races its own signal instead of waiting for that rejection.
    spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
      stdio: ["ignore", "inherit", "inherit"],
      detached: true,
    }).unref();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    break;
  }
  case "fail":
    say({ type: "turn.failed", error: { message: "boom from the model" } });
    break;
  case "crash":
    say({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "partial" } });
    process.stderr.write("fatal: something\n");
    process.exit(3);
    break;
  default:
    say({ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "thinking" } });
    say({
      type: "item.started",
      item: { id: "item_1", type: "command_execution", command: "echo hi", aggregated_output: "", status: "in_progress" },
    });
    say({
      type: "item.completed",
      item: {
        id: "item_1",
        type: "command_execution",
        command: "echo hi",
        aggregated_output: "hi\n",
        exit_code: 0,
        status: "completed",
      },
    });
    say({
      type: "item.completed",
      item: { id: "item_2", type: "file_change", changes: [{ path: "notes.md", kind: "add" }], status: "completed" },
    });
    say({ type: "item.completed", item: { id: "item_3", type: "agent_message", text: "Wrote notes.md" } });
    say({
      type: "turn.completed",
      usage: {
        input_tokens: 1200,
        cached_input_tokens: 200,
        cache_write_input_tokens: 0,
        output_tokens: 300,
        reasoning_output_tokens: 100,
      },
    });
}
process.exit(0);
