// LAB-153 characterization POC — @openai/codex-sdk 0.152.1 against a fake `codex`.
//
// Throwaway. Answers the premises the LAB-153 spec rests on with NO API key and
// NO network beyond fetching the SDK tarball once (set CODEX_SDK_PATH to the
// package's dist/index.js to skip even that). Run:
//
//     node spec-poc/LAB-153-codex-sdk-shape/run.mjs
//
// Each PASS/FAIL line is one premise. The one labelled FINDING is a fact the
// spec had to absorb (§9 of spec/LAB-153.md), not a defect in the fake.
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.152.1";
const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fake-codex.sh");
const LOG = join(mkdtempSync(join(tmpdir(), "lab153-poc-")), "fake.log");
chmodSync(FAKE, 0o755);

async function loadSdk() {
  if (process.env.CODEX_SDK_PATH) return import(process.env.CODEX_SDK_PATH);
  const dir = mkdtempSync(join(tmpdir(), "codex-sdk-"));
  const url = `https://registry.npmjs.org/@openai/codex-sdk/-/codex-sdk-${VERSION}.tgz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const tgz = join(dir, "sdk.tgz");
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  const tar = spawnSync("tar", ["xzf", tgz, "-C", dir]);
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
  // dist/index.js imports node builtins only; the MCP types are d.ts-only.
  return import(join(dir, "package/dist/index.js"));
}
const { Codex } = await loadSdk();

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const fresh = (mode) => {
  writeFileSync(LOG, "");
  return new Codex({
    codexPathOverride: FAKE,
    apiKey: "sk-test",
    env: { ...process.env, FAKE_CODEX_MODE: mode, FAKE_CODEX_LOG: LOG },
  });
};
const log = () => readFileSync(LOG, "utf8");

// 1. A fresh dispatch: thread id, items, usage, and the argv the SDK builds.
{
  const codex = fresh("ok");
  const thread = codex.startThread({
    workingDirectory: "/tmp",
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    skipGitRepoCheck: true,
    model: "gpt-5-codex",
  });
  const turn = await thread.run("write notes.md");
  check("dispatch: thread.id populated after run()", thread.id === "thr_fake_1", thread.id);
  check("dispatch: finalResponse is the last agent_message", turn.finalResponse === "Wrote notes.md", turn.finalResponse);
  check(
    "dispatch: usage is the turn.completed usage",
    turn.usage?.input_tokens === 1200 && turn.usage?.output_tokens === 300,
    JSON.stringify(turn.usage),
  );
  check(
    "dispatch: usage carries NO cost field (cost must be derived)",
    turn.usage !== null && !Object.keys(turn.usage).some((k) => /cost|usd/i.test(k)),
    Object.keys(turn.usage ?? {}).join(","),
  );
  const l = log();
  check(
    "dispatch: argv is `exec --experimental-json …` with --model/--sandbox/--cd/--skip-git-repo-check/approval_policy",
    /ARGV: exec --experimental-json .*--model gpt-5-codex .*--sandbox workspace-write --cd \/tmp --skip-git-repo-check --config approval_policy="never"/.test(l),
    l.split("\n")[0],
  );
  check("dispatch: prompt travels on stdin, not argv", /STDIN: write notes\.md/.test(l) && !/ARGV:.*write notes/.test(l));
  check("dispatch: apiKey option becomes CODEX_API_KEY in the child env", /CODEX_API_KEY=sk-test/.test(l));
  check(
    "dispatch: file_change item names path + kind",
    turn.items.some((i) => i.type === "file_change" && i.changes[0].path === "notes.md" && i.changes[0].kind === "add"),
  );
  check("dispatch: nothing in the wire names the model that ran", !/model/.test(JSON.stringify(turn)));
}

// 2. Streaming: the thread id is known from the FIRST event, before the turn ends.
{
  const codex = fresh("ok");
  const thread = codex.startThread();
  const { events } = await thread.runStreamed("x");
  let idAtFirstEvent = "not-seen";
  let n = 0;
  for await (const ev of events) {
    if (n++ === 0) idAtFirstEvent = ev.type === "thread.started" ? thread.id : `first event was ${ev.type}`;
  }
  check("stream: thread id is populated on the first event (thread.started)", idAtFirstEvent === "thr_fake_1", idAtFirstEvent);
}

// 3. Resume: resumeThread(id) → `codex exec … resume <id>`, same thread id back.
{
  const codex = fresh("ok");
  const thread = codex.resumeThread("thr_saved_42", { workingDirectory: "/tmp", skipGitRepoCheck: true });
  const turn = await thread.run("continue");
  check(
    "resume: argv ends with `resume <id>` (after every option)",
    /ARGV: exec --experimental-json .*resume thr_saved_42$/m.test(log()),
    log().split("\n")[0],
  );
  check("resume: the handle's thread id is the resumed id", thread.id === "thr_saved_42" && turn.finalResponse === "Wrote notes.md", thread.id);
}

// 4. Abort: a signal fired mid-run kills the child and the run REJECTS (a throw, not a status).
{
  const codex = fresh("hang");
  const thread = codex.startThread();
  const ac = new AbortController();
  const started = Date.now();
  const { events } = await thread.runStreamed("hang", { signal: ac.signal });
  let sawThreadId = null;
  let error = null;
  try {
    for await (const ev of events) {
      if (ev.type === "thread.started") {
        sawThreadId = thread.id;
        setTimeout(() => ac.abort(), 200);
      }
    }
  } catch (e) {
    error = e;
  }
  const elapsed = Date.now() - started;
  check("abort: the run rejects (throws) rather than returning a turn", error !== null, error?.message?.slice(0, 80));
  check("abort: the thread id was already known before the abort (resumable after a cancel)", sawThreadId === "thr_fake_1", sawThreadId);
  check("abort: the child was killed promptly (< 5s; the fake sleeps 30s)", elapsed < 5000, `${elapsed}ms`);
  check("abort: the rejection is an AbortError (distinguishable from a crash)", error?.name === "AbortError", error?.name);
}

// 4b. Abort when a GRANDCHILD of the CLI still holds stdout: the throw waits for the pipe to close.
{
  const codex = fresh("hang-grandchild");
  const thread = codex.startThread();
  const ac = new AbortController();
  const started = Date.now();
  const { events } = await thread.runStreamed("hang", { signal: ac.signal });
  let error = null;
  try {
    for await (const ev of events) {
      if (ev.type === "thread.started") setTimeout(() => ac.abort(), 200);
    }
  } catch (e) {
    error = e;
  }
  const elapsed = Date.now() - started;
  check("abort/grandchild: still rejects", error !== null, error?.message?.slice(0, 60));
  check(
    "abort/grandchild: FINDING — the rejection waits for stdout to close (here ~30s): a deadline on the block bounds the CLI, not what the CLI spawned",
    elapsed >= 5000,
    `${elapsed}ms`,
  );
}

// 5. A turn the model fails: run() throws with the turn.failed message; runStreamed yields the event.
{
  const codex = fresh("fail");
  let msg = null;
  try {
    await codex.startThread().run("fail");
  } catch (e) {
    msg = e.message;
  }
  check("turn.failed: run() throws the failure message", msg === "boom from the model", msg);
  const codex2 = fresh("fail");
  const { events } = await codex2.startThread().runStreamed("fail");
  const kinds = [];
  for await (const ev of events) kinds.push(ev.type);
  check("turn.failed: runStreamed yields the event and ends cleanly (exit 0)", kinds.includes("turn.failed"), kinds.join(","));
}

// 6. The CLI crashing (non-zero exit) → throw carrying stderr.
{
  const codex = fresh("crash");
  let msg = null;
  try {
    await codex.startThread().run("crash");
  } catch (e) {
    msg = e.message;
  }
  check("crash: non-zero exit throws `Codex Exec exited with code N: <stderr>`", /Codex Exec exited with code 3: fatal: something/.test(msg ?? ""), msg?.trim());
}

// 7. No turn.completed → usage is null, not zeros.
{
  const codex = fresh("nousage");
  const turn = await codex.startThread().run("x");
  check("no usage: turn.usage is null (never invented)", turn.usage === null, String(turn.usage));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} premises held`);
process.exit(failed.length ? 1 : 0);
