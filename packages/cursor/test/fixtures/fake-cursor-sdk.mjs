/**
 * A scripted stand-in for `@cursor/sdk`, loaded by the environment fence's
 * child process (and, for the control, in-process) in `env-fence.spec.ts`.
 *
 * It does the one thing the fence exists for the way the real SDK does: a
 * command the agent runs is spawned with `{ ...process.env }`, the copy
 * `@cursor/sdk` 1.0.31's shell executor makes. Its run reports what that
 * command printed and which variables its process held.
 *
 * The prompt picks the script:
 * - `echo` (default): run `printf` of `$FIX1917_CANARY` in a shell, then finish.
 * - `hang`: stream one message, then wait until cancelled; on cancel, write
 *   `cancelled` to `$FIX1917_CANCEL_MARK` when that is set.
 * - `die`: exit the process mid-run.
 * - `wedged`: stream one message, then wait forever; a cancel never settles,
 *   as a wedged runtime's might never.
 * - `steer` / `steer-refuse`: stream one message, then wait for a steer; it
 *   answers `complete_delivered` (or `revert_to_followup`), and the run ends
 *   with a message carrying the line it took.
 * - `command-hang` / `command-finish`: start a long-lived command (a dev
 *   server, a watcher) that writes its pid to `$COMMAND_DIR/pid` and, when sent
 *   SIGTERM, writes `$COMMAND_DIR/sigterm` and stays up; then behave as `hang`,
 *   or finish.
 */
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

function makeRun(prompt) {
  let steered = () => {};
  const steeredLine = new Promise((resolve) => {
    steered = resolve;
  });
  let release = () => {};
  const cancelled = new Promise((resolve) => {
    release = resolve;
  });
  return {
    id: "run_fake",
    async *stream() {
      if (prompt === "die") {
        yield { type: "thinking", text: "about to die" };
        process.exit(3);
      }
      if (prompt === "wedged") {
        yield { type: "thinking", text: "working" };
        await new Promise(() => {});
      }
      if (prompt === "steer" || prompt === "steer-refuse") {
        yield { type: "thinking", text: "working" };
        const line = await steeredLine;
        yield { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `took: ${line}` }] } };
        return;
      }
      if (prompt === "command-hang" || prompt === "command-finish") {
        startCommand(process.env.COMMAND_DIR);
        yield { type: "thinking", text: "working" };
        if (prompt === "command-hang") await cancelled;
        else yield { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "done" }] } };
        return;
      }
      if (prompt === "hang") {
        yield { type: "thinking", text: "working" };
        await cancelled;
        return;
      }
      const shell = spawnSync("/bin/sh", ["-c", 'printf %s "$FIX1917_CANARY"'], {
        env: { ...process.env },
        encoding: "utf8",
      });
      yield {
        type: "tool_call",
        call_id: "sh1",
        name: "shell",
        status: "completed",
        args: { command: "printf $FIX1917_CANARY" },
        result: { stdout: shell.stdout, envKeys: Object.keys(process.env).sort() },
      };
      yield { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "done" }] } };
    },
    async wait() {
      return { status: "finished", result: "done" };
    },
    async steer(text) {
      steered(prompt === "steer" ? text : "(refused)");
      return prompt === "steer" ? "complete_delivered" : "revert_to_followup";
    },
    async cancel() {
      if (prompt === "wedged") await new Promise(() => {});
      if (process.env.FIX1917_CANCEL_MARK) writeFileSync(process.env.FIX1917_CANCEL_MARK, "cancelled");
      release();
    },
  };
}

/** A command that outlives a SIGTERM, as the agent's shell would leave it running. */
function startCommand(dir) {
  const sigterm = JSON.stringify(`${dir}/sigterm`);
  const child = spawn(
    process.execPath,
    ["-e", `process.on('SIGTERM', () => require('fs').writeFileSync(${sigterm}, '1')); setInterval(() => {}, 1000)`],
    { stdio: "ignore" },
  );
  writeFileSync(`${dir}/pid`, String(child.pid));
}

function makeAgent(agentId) {
  return {
    agentId,
    async send(prompt) {
      return makeRun(prompt);
    },
    close() {},
  };
}

export const Agent = {
  async create() {
    return makeAgent("agent_fake");
  },
  async resume(agentId) {
    if (agentId === "agent_gone") {
      throw Object.assign(new Error(`Agent ${agentId} not found`), {
        name: "AgentNotFoundError",
        code: "agent_not_found",
      });
    }
    return makeAgent(agentId);
  },
};
