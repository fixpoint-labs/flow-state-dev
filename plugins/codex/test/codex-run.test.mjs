// Tests for scripts/codex-run, driven against a stub `codex` executable so they
// need neither the real CLI nor an OpenAI login. Run: node --test plugins/codex/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "codex-run");

// Stub codex: records its argv, prints a session id the way `codex exec` does,
// writes the -o file with the prompt it got on stdin, then sleeps/exits on cue.
const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$STUB_ARGS"
prompt="$(cat)"
echo "session id: 0000-stub-session" >&2
out=""; prev=""
for a in "$@"; do [[ "$prev" == "-o" ]] && out="$a"; prev="$a"; done
sleep "\${STUB_SLEEP:-0}"
if [[ "\${STUB_EXIT:-0}" != 0 ]]; then echo "ERROR: stub failure" >&2; exit "$STUB_EXIT"; fi
printf 'codex says: %s' "$prompt" > "$out"
`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "codex-run-test-"));
  const bin = join(dir, "codex");
  writeFileSync(bin, STUB);
  chmodSync(bin, 0o755);
  const env = {
    ...process.env,
    CODEX_BIN: bin,
    CODEX_RUN_DIR: join(dir, "runs"),
    STUB_ARGS: join(dir, "args.txt"),
  };
  const run = (args, { input = "", extraEnv = {} } = {}) =>
    spawnSync(script, args, { input, env: { ...env, ...extraEnv }, encoding: "utf8", cwd: dir });
  const argv = () => readFileSync(env.STUB_ARGS, "utf8").trim().split("\n");
  return { dir, run, argv };
}

test("returns Codex's final message and session, sandboxed to workspace-write by default", () => {
  const { run, argv } = setup();
  const r = run([], { input: "fix the bug in foo.ts" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /status: completed/);
  assert.match(r.stdout, /session: 0000-stub-session/);
  assert.match(r.stdout, /----- codex final message -----\ncodex says: fix the bug in foo.ts/);
  const a = argv();
  assert.equal(a[0], "exec");
  assert.deepEqual(a.slice(a.indexOf("-s"), a.indexOf("-s") + 2), ["-s", "workspace-write"]);
  assert.equal(a.at(-1), "-", "prompt must be read from stdin, never passed as an argument");
});

test("model and reasoning effort are forwarded to codex", () => {
  const { run, argv } = setup();
  assert.equal(run(["-m", "gpt-x", "-e", "high", "-s", "read-only"], { input: "review" }).status, 0);
  const a = argv().join(" ");
  assert.match(a, /-s read-only/);
  assert.match(a, /-m gpt-x/);
  assert.match(a, /-c model_reasoning_effort="high"/);
});

test("a run that outlasts the timeout reports running, and --wait collects it", () => {
  const { run } = setup();
  const first = run(["-t", "0"], { input: "long task", extraEnv: { STUB_SLEEP: "3" } });
  assert.equal(first.status, 3, "still-running must be distinguishable from done");
  assert.match(first.stdout, /status: running/);
  const id = first.stdout.match(/^run: (.+)$/m)[1];

  const second = run(["--wait", id, "-t", "30"]);
  assert.equal(second.status, 0, second.stdout);
  assert.match(second.stdout, /codex says: long task/);
});

test("resume puts exec-only options before the resume subcommand", () => {
  const { run, argv } = setup();
  assert.equal(run(["-r", "abc-123", "-s", "read-only"], { input: "and now?" }).status, 0);
  const a = argv();
  const resumeAt = a.indexOf("resume");
  assert.deepEqual(a.slice(resumeAt), ["resume", "abc-123", "-"]);
  assert.ok(a.indexOf("-s") < resumeAt && a.indexOf("-C") < resumeAt, "codex exec resume rejects -s/-C after it");
});

test("a failed Codex run exits 1 and shows the log tail", () => {
  const { run } = setup();
  const r = run([], { input: "x", extraEnv: { STUB_EXIT: "1" } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /status: failed \(codex exited 1\)/);
  assert.match(r.stdout, /ERROR: stub failure/);
});

test("missing codex CLI exits 127 with install instructions", () => {
  const { run } = setup();
  const r = run([], { input: "x", extraEnv: { CODEX_BIN: "definitely-not-codex" } });
  assert.equal(r.status, 127);
  assert.match(r.stderr, /npm install -g @openai\/codex/);
});

test("usage errors exit 2: empty prompt, bad sandbox", () => {
  const { run } = setup();
  assert.equal(run([], { input: "  \n" }).status, 2);
  assert.equal(run(["-s", "yolo"], { input: "x" }).status, 2);
});
