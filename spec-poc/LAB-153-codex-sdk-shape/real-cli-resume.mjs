// LAB-153 characterization POC — the REAL Codex CLI/SDK leg (real-cli-resume.mjs).
//
// `run.mjs` proves the SDK's *shape* against a fake `codex` binary that echoes the
// resume id unconditionally by construction — so it cannot observe what the CLI
// actually does when asked to resume a thread it has never seen. This file drives
// the real, installed `@openai/codex` CLI (pinned 0.152.1, same as run.mjs) and the
// real `@openai/codex-sdk`, no fake anywhere, to settle exactly that: does a refused
// resume emit a `thread.started` (or any) event before failing?
//
// This is the fact LAB-153's own decision table (§9: "`resume` resolves to an id
// this host has never seen … the CLI exits non-zero; the block throws") and
// LAB-154's session-id rule ("a refused resume ends without the harness ever naming
// a session") both rest on. Nothing else in either spec's POCs exercises it.
//
// Needs network (fetches the pinned CLI + SDK from the npm registry once) and NO
// API key/auth — every check here resolves client-side, before any network call to
// api.openai.com. Run:
//
//     node spec-poc/LAB-153-codex-sdk-shape/real-cli-resume.mjs
//
// Skips (exit 0) rather than failing if the registry or `npx` isn't reachable —
// this is a settlement aid, not a CI gate.
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

const CODEX_CLI_VERSION = "0.152.1";
const CODEX_SDK_VERSION = "0.152.1";

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

// Resolve the real `codex` binary by asking npx to fetch the pinned CLI version,
// then locating the shim it installed. Skip cleanly if that isn't possible here.
function resolveRealCodexBinary() {
  const probe = sh("npx", ["--yes", `@openai/codex@${CODEX_CLI_VERSION}`, "--version"], { timeout: 120_000 });
  if (probe.status !== 0) return null;
  const cacheDir = sh("npm", ["config", "get", "cache"]).stdout.trim();
  const find = sh("find", [join(cacheDir, "_npx"), "-maxdepth", "6", "-path", "*/@openai/codex/bin/codex.js"]);
  const path = find.stdout.trim().split("\n").find(Boolean);
  return path || null;
}

async function loadSdk() {
  if (process.env.CODEX_SDK_PATH) return import(process.env.CODEX_SDK_PATH);
  const dir = mkdtempSync(join(tmpdir(), "codex-sdk-real-"));
  const url = `https://registry.npmjs.org/@openai/codex-sdk/-/codex-sdk-${CODEX_SDK_VERSION}.tgz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const tgz = join(dir, "sdk.tgz");
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  const tar = spawnSync("tar", ["xzf", tgz, "-C", dir]);
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
  return import(join(dir, "package/dist/index.js"));
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const codexBin = resolveRealCodexBinary();
if (!codexBin) {
  console.log("SKIP  no network/npx access to the real `codex` CLI in this environment — cannot settle this claim here.");
  console.log("      Needs: npx reaching registry.npmjs.org for @openai/codex@" + CODEX_CLI_VERSION + " (no API key required).");
  process.exit(0);
}
console.log(`using real codex CLI at ${codexBin}`);

const { Codex } = await loadSdk();

function freshHome() {
  return mkdtempSync(join(tmpdir(), "codex-home-"));
}

// 1. NEGATIVE: resume a well-formed UUID the CLI has never seen (fresh, empty
//    CODEX_HOME — no rollout can exist). This is the disputed case.
{
  const home = freshHome();
  const deadId = crypto.randomUUID();
  const codex = new Codex({ codexPathOverride: codexBin, env: { ...process.env, CODEX_HOME: home } });
  const thread = codex.resumeThread(deadId, { skipGitRepoCheck: true });
  let sawAnyEvent = false;
  let sawThreadStarted = false;
  let error = null;
  try {
    const { events } = await thread.runStreamed("continue");
    for await (const ev of events) {
      sawAnyEvent = true;
      if (ev.type === "thread.started") sawThreadStarted = true;
    }
  } catch (e) {
    error = e;
  }
  check(
    "resume/dead-id: the call fails (throws) rather than completing a turn",
    error !== null,
    error?.message?.slice(0, 100),
  );
  check(
    "resume/dead-id: the CLI's stdout produced NO event at all before failing (no thread.started, nothing)",
    !sawAnyEvent,
    sawAnyEvent ? "an event WAS observed — see log" : "zero stdout events, as LAB-153 §9 / LAB-154 assume",
  );
  check("resume/dead-id: in particular, no thread.started fired", !sawThreadStarted);
  check(
    "resume/dead-id: the SDK's own Thread never updates .id from a stream event on this path (stays the caller-supplied dead id, never overwritten)",
    thread.id === deadId,
    thread.id,
  );
  check(
    "resume/dead-id: the failure names the real cause (no rollout found), not a generic crash",
    /no rollout found/i.test(error?.message ?? ""),
    error?.message,
  );
}

// 2. POSITIVE CONTROL: resume a thread the CLI DOES have. Proves check #1's
//    "no event" result is a real discriminator, not the check's inability to see
//    ANY event from the real CLI at all.
{
  const home = freshHome();
  const codex1 = new Codex({ codexPathOverride: codexBin, env: { ...process.env, CODEX_HOME: home } });
  const thread1 = codex1.startThread({ skipGitRepoCheck: true });
  try {
    await thread1.run("hi");
  } catch {
    // Expected: no auth in this environment, the turn itself fails. We only need
    // the thread to have been named and its rollout persisted, both of which
    // happen before any model call.
  }
  const realId = thread1.id;
  check("control: a fresh dispatch DOES get a real thread id from the CLI", typeof realId === "string" && realId.length > 0, realId);

  const codex2 = new Codex({ codexPathOverride: codexBin, env: { ...process.env, CODEX_HOME: home } });
  const thread2 = codex2.resumeThread(realId, { skipGitRepoCheck: true });
  let sawMatchingThreadStarted = false;
  try {
    const { events } = await thread2.runStreamed("continue");
    for await (const ev of events) {
      if (ev.type === "thread.started" && ev.thread_id === realId) sawMatchingThreadStarted = true;
    }
  } catch {
    // Expected: fails later on auth. We only care what happened before that.
  }
  check(
    "control: resuming a thread the CLI DOES have fires thread.started with the matching id before anything else can fail",
    sawMatchingThreadStarted,
    String(sawMatchingThreadStarted),
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} premises held`);
process.exit(failed.length ? 1 : 0);
