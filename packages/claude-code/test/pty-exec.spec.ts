/**
 * Tests for the PTY-backed `claude` exec.
 *
 * The root issue: `claude --remote` refuses to dispatch unless stdout is a TTY.
 * A bare spawn (the package default) pipes stdout, so the child sees no terminal
 * and `--remote` exits 1. `scriptPtyClaudeCliExec` runs the CLI under `script(1)`
 * so the child sees a real terminal. The probe runs `node` (a stand-in for
 * `claude`) and reports whether its stdout is a TTY — no cloud dispatch, so the
 * test is hermetic.
 */
import { describe, it, expect } from "vitest";
import { defaultClaudeCliExec, scriptPtyClaudeCliExec } from "../src/cli";

/** Make the child print whether its stdout is a TTY. */
const TTY_PROBE = ["-e", "process.stdout.write('isTTY=' + Boolean(process.stdout.isTTY))"];

describe("scriptPtyClaudeCliExec", () => {
  it("gives the child a real TTY, unlike the bare-spawn default exec", async () => {
    // The bug: a bare spawn pipes stdout, so `claude --remote` is rejected.
    const bare = await defaultClaudeCliExec(process.execPath, TTY_PROBE, {});
    expect(bare.stdout).toContain("isTTY=false");

    // The fix: under script(1) the child sees a terminal, so `--remote` runs.
    const pty = await scriptPtyClaudeCliExec(process.execPath, TTY_PROBE, {});
    expect(pty.code).toBe(0);
    expect(pty.stdout).toContain("isTTY=true");
  });

  it("resolves once the session URL has streamed in, without waiting for exit", async () => {
    // `claude --remote` creates the cloud session server-side the moment it
    // prints its banner; the local process may linger. We must not block on the
    // process exiting (a cold start can hang for the full timeout) — but we also
    // must wait for the `View: <url>` line so the handle carries the URL, not
    // resolve on the earlier "Created remote session" line and lose it. Fake a
    // claude that prints the header first, the URL ~800ms later, then hangs.
    const start = Date.now();
    const result = await scriptPtyClaudeCliExec(
      process.execPath,
      [
        "-e",
        "console.log('Created remote session: test'); " +
          "setTimeout(() => console.log('View: https://claude.ai/code/session_banner_test'), 800); " +
          "setTimeout(() => {}, 30000)",
      ],
      { timeoutMs: 60_000 },
    );
    const elapsed = Date.now() - start;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("claude.ai/code/session_banner_test");
    expect(elapsed).toBeLessThan(10_000);
  }, 20_000);

  it("does not leak a local ANTHROPIC_API_KEY into the dispatched child", async () => {
    // `claude --remote` blocks on a "Detected a custom API key" confirmation
    // dialog when it inherits ANTHROPIC_API_KEY. The dispatch authenticates as
    // the logged-in user, so a local key must be scrubbed.
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-should-be-scrubbed";
    try {
      const result = await scriptPtyClaudeCliExec(
        process.execPath,
        ["-e", "process.stdout.write('KEY=' + (process.env.ANTHROPIC_API_KEY ?? 'absent'))"],
        {},
      );
      expect(result.stdout).toContain("KEY=absent");
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it("resolves with the child's non-zero exit code (does not reject)", async () => {
    // The ClaudeCliExec contract: a failed dispatch is a non-zero `code`, not a
    // rejection — the dispatch block distinguishes that from an unlaunchable
    // binary (ENOENT → rejection).
    const result = await scriptPtyClaudeCliExec(process.execPath, ["-e", "process.exit(3)"], {});
    expect(result.code).toBe(3);
  });
});
