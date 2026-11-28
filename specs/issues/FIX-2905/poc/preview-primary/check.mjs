#!/usr/bin/env node
/**
 * FIX-2905 experiment: a preview kept in the person's PRIMARY checkout, on a local-only
 * `preview/<user>` branch, that merges every in-flight branch behind two gates.
 *
 * Throwaway evidence in a disposable repository. Not wired into CI or any default
 * discovery. Run from anywhere:
 *
 *   node specs/issues/FIX-2905/poc/preview-primary/check.mjs
 *   node specs/issues/FIX-2905/poc/preview-primary/check.mjs --control no-boot
 *
 * The build below is a small prototype of what `fsdev worktrees --preview` would do. The
 * assertions never read its report: they read the preview's ancestry and tree, and boot the
 * preview's tree with their own code (`serves`).
 *
 *   P1  turn on: `preview/u` is made without an upstream, and the person's uncommitted edits
 *       are still there afterwards; a rebuild keeps them (reset --keep), and stops, naming
 *       nothing lost, when main changed a file they edit;
 *   P2  in-flight tips merge; a conflicting branch is left out; a branch with no commits is
 *       contained and not a conflict;
 *   P3  gate 1: a branch whose checks are red at its tip is left out; a result recorded for
 *       the tip is read, not rerun; a moved branch is checked again at its new tip;
 *   P4  a branch that changes the lockfile is left out as "install owed", never merged;
 *   P5  gate 2: two branches each green and each booting alone, that break the app only
 *       together: the combination is refused, the culprit named, the rest still show, and
 *       the tree that stays boots;
 *   P6  nothing boots: the preview goes back to its previous tip;
 *   P7  a hand resolution is replayed by rerere; a hand commit blocks a rebuild;
 *   P8  the shipped push guard (scripts/check-preview-push.mjs) refuses HEAD to another name
 *       and the preview by name, and lets a feature branch push. What it does NOT stop is
 *       measured and printed as GAP, not asserted.
 *
 * `--control no-boot` builds without gate 2. The pair that breaks only together then goes
 * through, the preview's tree does not boot, and this script must exit 1.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:net";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const control = process.argv.includes("--control") ? process.argv[process.argv.indexOf("--control") + 1] : null;
const bootGate = control !== "no-boot";
const GUARD = resolve(fileURLToPath(new URL("../../../../../scripts/check-preview-push.mjs", import.meta.url)));
let failures = 0;
const expect = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};
const gap = (text) => console.log(`GAP   ${text}`);
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const out = (cwd, ...a) => {
  try {
    return { ok: true, text: git(cwd, ...a) };
  } catch (e) {
    return { ok: false, text: `${e.stderr ?? ""}${e.stdout ?? ""}` };
  }
};
const ok = (cwd, ...a) => out(cwd, ...a).ok;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const put = (cwd, file, text, msg) => {
  mkdirSync(join(cwd, file, ".."), { recursive: true });
  writeFileSync(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", msg);
};
const route = (path) => JSON.stringify({ path }) + "\n";

// ── the scratch app ───────────────────────────────────────────────────────────────────
// Boots on the port it is given and serves /health, unless two route files claim one path.
const APP = `import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
const paths = readdirSync("routes").map((f) => JSON.parse(readFileSync("routes/" + f, "utf8")).path);
const dup = paths.find((p, i) => paths.indexOf(p) !== i);
if (dup) { console.error("route registered twice: " + dup); process.exit(1); }
createServer((q, r) => { r.statusCode = q.url === "/health" ? 200 : 404; r.end("ok"); }).listen(Number(process.argv[2]), "127.0.0.1");
`;
// The per-branch checks: each route file parses, and no BROKEN marker. They cannot see two files claim one path.
const CHECKS = `import { readdirSync, readFileSync, existsSync } from "node:fs";
if (existsSync("BROKEN")) { console.error("BROKEN marker"); process.exit(1); }
for (const f of readdirSync("routes")) JSON.parse(readFileSync("routes/" + f, "utf8"));
`;

const freePort = () =>
  new Promise((res) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

// ── the prototype build (what the tool would do) ──────────────────────────────────────
async function boot(tree) {
  const port = await freePort();
  const child = spawn("node", ["app.mjs", String(port)], { cwd: tree, stdio: "ignore" });
  let exited = false;
  child.on("exit", () => (exited = true));
  const until = Date.now() + 4000;
  try {
    while (Date.now() < until && !exited) {
      const r = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
      if (r?.ok) return true;
      await sleep(80);
    }
    return false;
  } finally {
    child.kill("SIGKILL");
  }
}

/** Gate 1: a result recorded for this exact tip, else the checks run in the branch's worktree and are kept by tip. */
function greenAt(ctx, branch) {
  const tip = git(ctx.primary, "rev-parse", `refs/heads/feat/${branch}`);
  if (ctx.recorded.has(tip)) return ctx.recorded.get(tip);
  if (ctx.cache.has(tip)) return ctx.cache.get(tip);
  ctx.runs.push(`${branch}@${tip.slice(0, 7)}`);
  const green = spawnOk("node", ["checks.mjs"], ctx.wt(branch));
  ctx.cache.set(tip, green);
  return green;
}
const spawnOk = (cmd, args, cwd) => {
  try {
    execFileSync(cmd, args, { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/** Merge one branch into the preview; returns null when merged, else why not. */
function mergeOne(ctx, b) {
  const p = ctx.primary;
  const ref = `refs/heads/feat/${b}`;
  if (ok(p, "merge-base", "--is-ancestor", ref, "HEAD")) return null; // contained already
  const r = out(p, "merge", "--no-ff", "--no-edit", ref);
  if (r.ok) return null;
  const files = out(p, "diff", "--name-only", "--diff-filter=U").text;
  if (files === "" && existsSync(join(p, ".git", "MERGE_HEAD"))) {
    // rerere replayed a recorded resolution and staged it: finish the merge.
    if (ok(p, "commit", "--no-edit")) return null;
  }
  ok(p, "merge", "--abort");
  return { reason: "conflict", files: files.split("\n").filter(Boolean) };
}

async function build(ctx, branches) {
  const p = ctx.primary;
  const report = { merged: [], left: [], refused: null, kept: false };
  const done = (r) => ((ctx.built = new Set(r.merged)), r);
  git(p, "fetch", "-q", "origin", "main");
  const base = git(p, "rev-parse", "FETCH_HEAD");
  // Rebuild guard, the shipped rule: nothing on the preview that no base or listed branch has.
  // A branch dropped from the list since the last build still sits in the preview: its commits are not "own" work.
  const listed = [...new Set([...branches, ...ctx.built])].map((b) => `refs/heads/feat/${b}`);
  const own = git(p, "log", "--no-merges", "--format=%h", "HEAD", "--not", base, ...listed);
  if (own !== "") return { ...report, refused: `the preview holds its own commit(s): ${own.split("\n").join(", ")}` };
  const previous = git(p, "rev-parse", "HEAD");
  const reset = out(p, "reset", "--keep", base);
  if (!reset.ok) return { ...report, refused: `reset --keep stopped: ${reset.text.split("\n")[0]}` };
  const accepted = [];
  for (const b of branches) {
    if (!greenAt(ctx, b)) {
      report.left.push({ b, reason: "checks-red" });
      continue;
    }
    const tip = `refs/heads/feat/${b}`;
    if (git(p, "diff", "--name-only", `${base}...${tip}`).split("\n").includes("pnpm-lock.yaml")) {
      report.left.push({ b, reason: "install-owed" });
      continue;
    }
    const why = mergeOne(ctx, b);
    if (why) report.left.push({ b, ...why });
    else accepted.push(b);
  }
  if (!bootGate || accepted.length === 0) return done({ ...report, merged: accepted });
  if (await boot(p)) return done({ ...report, merged: accepted });
  // The combination does not boot. Name the culprit by re-merging one at a time, booting after each.
  git(p, "reset", "--keep", base);
  for (const b of accepted) {
    const before = git(p, "rev-parse", "HEAD");
    mergeOne(ctx, b);
    if (await boot(p)) report.merged.push(b);
    else {
      git(p, "reset", "--keep", before);
      report.left.push({ b, reason: "boot", after: [...report.merged] });
    }
  }
  if (report.merged.length === 0 && !(await boot(p))) {
    // Nothing boots, not even the base: keep the previous tip.
    git(p, "reset", "--keep", previous);
    return { ...report, merged: [], kept: true };
  }
  return done(report);
}

// ── scratch repository ────────────────────────────────────────────────────────────────
const S = mkdtempSync(join(tmpdir(), "preview-primary-"));
try {
  git(S, "init", "-q", "--bare", "-b", "main", "remote.git");
  git(S, "init", "-q", "-b", "main", "primary");
  const primary = join(S, "primary");
  for (const [k, v] of [["user.email", "a@b.c"], ["user.name", "t"], ["commit.gpgsign", "false"], ["rerere.enabled", "true"], ["rerere.autoupdate", "true"]]) git(primary, "config", "--local", k, v);
  put(primary, "app.mjs", APP, "app");
  put(primary, "checks.mjs", CHECKS, "checks");
  put(primary, "routes/home.json", route("/"), "home");
  put(primary, "shared.txt", "line\n", "shared");
  put(primary, "notes.md", "notes\n", "notes");
  put(primary, "pnpm-lock.yaml", "lock: 1\n", "lock");
  git(primary, "remote", "add", "origin", join(S, "remote.git"));
  git(primary, "push", "-q", "origin", "main");
  git(primary, "fetch", "-q", "origin");

  // In-flight branches, each its own worktree off origin/main, as workers have.
  const wt = (b) => join(S, "wt", b);
  const feature = (b, edit) => {
    git(primary, "worktree", "add", "-q", "-b", `feat/${b}`, wt(b), "origin/main");
    if (edit) edit(wt(b));
  };
  feature("export", (d) => { put(d, "routes/export.json", route("/export"), "export"); put(d, "shared.txt", "line\nexport\n", "export shared"); });
  feature("login", (d) => put(d, "routes/login.json", route("/login"), "login"));
  feature("docs", (d) => put(d, "shared.txt", "line\ndocs\n", "docs shared"));
  feature("fresh");
  feature("lock", (d) => put(d, "pnpm-lock.yaml", "lock: 2\n", "lockfile"));
  feature("red", (d) => put(d, "BROKEN", "x\n", "broken"));
  feature("dupA", (d) => put(d, "routes/pa.json", route("/report"), "report a"));
  feature("dupB", (d) => put(d, "routes/pb.json", route("/report"), "report b"));

  // The shipped push guard, as a pre-push hook in the primary, fed git's pushed-ref lines.
  const hook = join(primary, ".git", "hooks", "pre-push");
  writeFileSync(hook, `#!/bin/sh\nnode ${GUARD}\n`, { mode: 0o755 });

  // ── P1 turn on, with the person's own uncommitted edits in the primary ──
  appendFileSync(join(primary, "notes.md"), "my unfinished thought\n");
  writeFileSync(join(primary, "scratch.txt"), "untracked\n");
  git(primary, "switch", "-q", "--no-track", "-c", "preview/u", "origin/main");
  expect(out(primary, "config", "--get", "branch.preview/u.remote").ok === false, "P1 preview/u has no upstream");
  expect(readFileSync(join(primary, "notes.md"), "utf8").includes("my unfinished thought") && existsSync(join(primary, "scratch.txt")), "P1 turning on carried the uncommitted edits across");
  const ctx = { primary, wt, runs: [], cache: new Map(), recorded: new Map(), built: new Set() };
  const all = ["export", "login", "docs", "fresh", "lock", "red", "dupA", "dupB"];
  for (const b of all) git(primary, "config", "--local", "--add", "preview.branch", `feat/${b}`);
  const tipOf = (b) => git(primary, "rev-parse", `refs/heads/feat/${b}`);
  const inPreview = (b) => ok(primary, "merge-base", "--is-ancestor", `refs/heads/feat/${b}`, "HEAD");
  /** The check's own reading of the tree: boot it with different code from the build's. */
  const serves = (tree) =>
    new Promise(async (done) => {
      const port = await freePort();
      const child = spawn("node", ["app.mjs", String(port)], { cwd: tree, stdio: "ignore" });
      const stop = (v) => { child.kill("SIGKILL"); done(v); };
      child.on("exit", () => done(false));
      for (let i = 0; i < 50; i++) {
        const live = await new Promise((r) => get(`http://127.0.0.1:${port}/health`, (res) => r(res.statusCode === 200)).on("error", () => r(false)));
        if (live) return stop(true);
        await sleep(80);
      }
      stop(false);
    });

  // The recorded result for export's tip (as a Teammates run's record would give): read, not rerun.
  ctx.recorded.set(tipOf("export"), true);
  const r1 = await build(ctx, all);
  const reasons = Object.fromEntries(r1.left.map((l) => [l.b, l]));
  console.log("      build report (not asserted):", JSON.stringify({ merged: r1.merged, left: r1.left.map((l) => `${l.b}:${l.reason}`) }));

  // P2
  expect(["export", "login", "dupA"].every(inPreview), "P2 export, login and dupA tips are ancestors of the preview");
  expect(!inPreview("docs") && reasons.docs?.reason === "conflict" && reasons.docs.files.includes("shared.txt"), "P2 docs conflicts after export: not in the preview, named with shared.txt");
  expect(tipOf("fresh") === git(primary, "rev-parse", "origin/main") && inPreview("fresh") && !reasons.fresh, "P2 a branch with no commits is contained, not a conflict");
  expect(["export", "login", "dupA"].every((b) => existsSync(join(primary, "routes", `${b === "dupA" ? "pa" : b}.json`))), "P2 merged branches' own files are in the tree");
  // P3
  expect(!inPreview("red") && reasons.red?.reason === "checks-red", "P3 red checks at the tip: left out");
  expect(!ctx.runs.some((r) => r.startsWith("export@")) && ctx.runs.some((r) => r.startsWith("login@")), "P3 export's recorded result was read, not rerun; login's checks ran");
  // P4
  expect(!inPreview("lock") && reasons.lock?.reason === "install-owed", "P4 a lockfile change is left out as install owed, never merged");
  // P5
  const aloneGreen = (b) => spawnOk("node", ["checks.mjs"], wt(b));
  expect(aloneGreen("dupA") && aloneGreen("dupB") && (await serves(wt("dupA"))) && (await serves(wt("dupB"))), "P5 dupA and dupB each pass their checks and each boots alone");
  const pair = join(S, "pair");
  git(S, "clone", "-q", primary, pair);
  git(pair, "checkout", "-q", "--detach", "origin/main");
  for (const b of ["dupA", "dupB"]) {
    git(pair, "fetch", "-q", primary, `refs/heads/feat/${b}`);
    git(pair, "-c", "user.email=a@b.c", "-c", "user.name=t", "merge", "-q", "--no-edit", "FETCH_HEAD");
  }
  expect(!(await serves(pair)), "P5 merged together, dupA and dupB do not boot (the break is real, and git sees no conflict)");
  expect(inPreview("dupA") !== inPreview("dupB"), "P5 the preview holds one of the pair, never both");
  expect(reasons.dupB?.reason === "boot" && reasons.dupB.after.includes("dupA"), "P5 the culprit is named, with what merged before it");
  expect(await serves(primary), "P5 the preview's own tree boots");
  expect(readFileSync(join(primary, "notes.md"), "utf8").includes("my unfinished thought") && existsSync(join(primary, "scratch.txt")), "P1 the rebuild kept the person's uncommitted edits");

  // P7 a hand resolution is replayed; a hand commit blocks a rebuild
  const hand = out(primary, "merge", "--no-ff", "--no-edit", "refs/heads/feat/docs");
  expect(!hand.ok, "P7 setup: docs conflicts when merged by hand");
  writeFileSync(join(primary, "shared.txt"), "line\nexport\ndocs\n");
  git(primary, "add", "shared.txt");
  git(primary, "commit", "-q", "--no-edit");
  const r2 = await build(ctx, all);
  expect(!r2.refused && inPreview("docs") && readFileSync(join(primary, "shared.txt"), "utf8") === "line\nexport\ndocs\n", "P7 the rebuild replayed the hand resolution: docs is in, with the person's text");
  // P3 again: a branch that moves is checked at its new tip
  put(wt("login"), "BROKEN", "x\n", "login now broken");
  const r3 = await build(ctx, all);
  expect(!inPreview("login") && r3.left.some((l) => l.b === "login" && l.reason === "checks-red"), "P3 login moved to a red tip: checked again, left out");
  expect(ctx.runs.filter((r) => r.startsWith("login@")).length === 2, "P3 login ran its checks once per tip, no more");
  put(primary, "hand.txt", "mine\n", "a hand commit on the preview");
  const r4 = await build(ctx, all);
  expect(r4.refused !== null && git(primary, "log", "-1", "--format=%s") === "a hand commit on the preview", "P7 a hand commit blocks the rebuild and nothing is reset");
  git(primary, "reset", "-q", "--keep", "HEAD~1"); // never --hard: it would take the person's edits

  // P8 the shipped push guard
  git(primary, "config", "--local", "--unset-all", "preview.branch");
  for (const b of ["export", "dupA"]) git(primary, "config", "--local", "--add", "preview.branch", `feat/${b}`);
  await build(ctx, ["export", "dupA"]);
  const push = (...a) => out(primary, "push", "-q", ...a);
  expect(!push("origin", "HEAD:refs/heads/other").ok && !ok(join(S, "remote.git"), "rev-parse", "--verify", "refs/heads/other"), "P8 HEAD to another name is refused, and the remote has nothing");
  expect(!push("origin", "preview/u").ok, "P8 the preview by name is refused");
  expect(push("origin", "feat/export").ok, "P8 a feature branch still pushes");
  git(primary, "update-ref", "-d", "refs/remotes/origin/feat/export");
  const leak = push("--no-verify", "origin", "HEAD:refs/heads/leak");
  if (leak.ok) gap("--no-verify pushes the preview (a hook is bypassed by design: accident prevention, not structure)");
  git(primary, "switch", "-q", "-c", "cut-from-preview");
  put(primary, "extra.txt", "x\n", "a commit on a branch cut from the preview");
  const cut = push("origin", "HEAD:refs/heads/cut");
  if (cut.ok) gap("a commit on a branch cut from the preview, pushed: the guard judges preview tips, so it goes through");
  git(primary, "switch", "-q", "preview/u");

  // P6 nothing boots: the base itself is broken, so the previous tip is kept
  const keptBefore = git(primary, "rev-parse", "HEAD");
  const clone = join(S, "maint");
  git(S, "clone", "-q", join(S, "remote.git"), clone);
  git(clone, "config", "user.email", "a@b.c"); git(clone, "config", "user.name", "t"); git(clone, "config", "commit.gpgsign", "false");
  put(clone, "routes/home2.json", route("/"), "main now registers / twice");
  git(clone, "push", "-q", "origin", "main");
  const r6 = await build(ctx, ["export", "dupA"]);
  expect(bootGate ? r6.kept && git(primary, "rev-parse", "HEAD") === keptBefore : true, "P6 nothing boots: the preview stays at its previous tip");
  // P1 again: main changed a file the person is editing: reset --keep stops, HEAD stays
  put(clone, "notes.md", "notes changed on main\n", "main edits notes");
  git(clone, "push", "-q", "origin", "main");
  const head = git(primary, "rev-parse", "HEAD");
  const r7 = await build(ctx, ["export", "dupA"]);
  expect(r7.refused?.startsWith("reset --keep stopped") && git(primary, "rev-parse", "HEAD") === head && readFileSync(join(primary, "notes.md"), "utf8").includes("my unfinished thought"), "P1 main changed a file the person edits: the build stops, HEAD and the edit are kept");

  console.log(control ? `\ncontrol ${control}: ${failures > 0 ? "FAILED as it must" : "did NOT fail, which is a defect in the check"}` : "");
} finally {
  rmSync(S, { recursive: true, force: true });
}
process.exit(failures > 0 ? 1 : 0);
