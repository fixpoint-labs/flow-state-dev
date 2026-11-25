/**
 * Tests for `scripts/worktree.mjs prune` and the preview guard in `.husky/pre-push`, each run
 * against a disposable repository with a bare origin. Prune deletes directories, so each keep
 * rule has a case that fails if the rule stops holding; the hook cases check that the guard
 * refuses a preview push and that the checks after it still receive the pushed refs.
 *
 * Run with `node --test scripts/worktree.test.mjs`.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** process.env without the GIT_* variables a caller (say, a git hook) may have set. */
function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
}

/**
 * A primary checkout cloned from a bare origin whose main holds one commit, so each case can
 * lay out worktrees against a real origin/main.
 */
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "fsd-worktree-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = {
    ...cleanEnv(),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.test",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.test",
  };
  const primary = join(dir, "primary");
  const run = (cwd, command, args, { input, extraEnv } = {}) => {
    const out = spawnSync(command, args, { cwd, env: { ...env, ...extraEnv }, input, encoding: "utf8" });
    return { ...out, text: `${out.stdout}${out.stderr}` };
  };
  const git = (cwd, ...args) => {
    const out = run(cwd, "git", args);
    assert.equal(out.status, 0, out.text);
    return out.stdout.trim();
  };
  git(dir, "init", "-q", "--bare", "-b", "main", "origin.git");
  git(dir, "clone", "-q", join(dir, "origin.git"), primary);
  writeFileSync(join(primary, ".gitignore"), ".claude/worktrees/\n.orchestration/\nlabs/\n");
  git(primary, "add", ".gitignore");
  git(primary, "commit", "-q", "-m", "base");
  git(primary, "push", "-q", "origin", "HEAD:main");
  git(primary, "fetch", "-q", "origin");

  /** A worktree at `<primary>/<at>/<name>` on a fresh branch from origin/main. */
  const worktree = (name, { commit = false, branch = name, at = ".claude/worktrees" } = {}) => {
    const path = join(primary, at, name);
    git(primary, "worktree", "add", "-q", "--no-track", "-b", branch, path, "origin/main");
    if (commit) git(path, "commit", "-q", "--allow-empty", "-m", `${name} work`);
    return path;
  };
  const prune = (...args) => run(primary, process.execPath, [join(ROOT, "scripts/worktree.mjs"), "prune", ...args]);

  // Stand-ins for pnpm and node, so the hook's lint and vocabulary steps log their arguments
  // instead of linting this disposable repository.
  const bin = join(dir, "bin");
  const log = join(dir, "hook.log");
  mkdirSync(bin);
  // The node stand-in also logs the stdin the preview guard receives.
  for (const name of ["pnpm", "node"]) {
    const stdin = name === "node" ? `case "$1" in *check-preview-push*) cat >> "${log}" ;; esac\n` : "";
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${stdin}`);
    chmodSync(join(bin, name), 0o755);
  }
  const prePush = (lines) => {
    rmSync(log, { force: true });
    const out = run(primary, "sh", ["-e", join(ROOT, ".husky/pre-push")], {
      input: `${lines.join("\n")}\n`,
      extraEnv: { PATH: `${bin}:${process.env.PATH}` },
    });
    return { ...out, log: existsSync(log) ? readFileSync(log, "utf8") : "" };
  };
  const guard = (lines) =>
    run(primary, process.execPath, [join(ROOT, "scripts/check-preview-push.mjs")], { input: `${lines.join("\n")}\n` });
  return { primary, git, worktree, prune, prePush, guard };
}

/** One worktree per rule: only clean work already in origin/main may go. */
function layout(f) {
  const merged = f.worktree("merged", { commit: true });
  f.git(f.primary, "push", "-q", "origin", "merged:main");
  f.git(f.primary, "fetch", "-q", "origin");
  const fresh = f.worktree("fresh");
  writeFileSync(join(f.worktree("dirty"), "notes.txt"), "draft\n");
  f.worktree("unlanded", { commit: true });
  const locked = f.worktree("locked");
  f.git(f.primary, "worktree", "lock", locked);
  f.worktree("live");
  f.git(f.primary, "config", "--add", "preview.branch", "live");
  f.worktree("issue", { branch: "fix/fix-1" });
  mkdirSync(join(f.primary, ".orchestration"));
  writeFileSync(join(f.primary, ".orchestration", "FIX-1.md"), "issue: FIX-1\nbranch: fix/fix-1\n");
  const detached = f.worktree("detached", { commit: true });
  f.git(detached, "switch", "-q", "--detach");
  f.git(f.primary, "branch", "-q", "-D", "detached");
  // Detached at a commit that is on a remote branch, but not in origin/main.
  const pushed = f.worktree("pushed-detached", { commit: true });
  f.git(pushed, "push", "-q", "origin", "HEAD:refs/heads/wip");
  f.git(pushed, "switch", "-q", "--detach");
  f.git(f.primary, "branch", "-q", "-D", "pushed-detached");
  // A handle cache that records the worktree path but no branch.
  const claimed = f.worktree("claimed", { branch: "fix/fix-2" });
  writeFileSync(join(f.primary, ".orchestration", "FIX-2.md"), `issue: FIX-2\nbranch: -\nworktree: ${claimed}\n`);
  // An app-owned run checkout: landed and clean, but outside .claude/worktrees/.
  const app = f.worktree("run", { at: "labs/teammates/.fsdev/runs", branch: "conductor/run" });
  const gone = f.worktree("gone");
  rmSync(gone, { recursive: true, force: true });
  return { merged, fresh, app, gone };
}

const KEPT = [
  ["dirty", "uncommitted changes"],
  ["unlanded", "commits not in origin/main"],
  ["locked", "locked"],
  ["live", "listed in preview.branch"],
  ["issue", "named in an .orchestration handle cache"],
  ["detached", "detached with commits not in origin/main"],
  ["pushed-detached", "detached with commits not in origin/main"],
  ["claimed", "named in an .orchestration handle cache"],
];

test("prune lists what it would remove and removes nothing without --yes", (t) => {
  const f = fixture(t);
  const { merged, fresh, app } = layout(f);

  const out = f.prune();

  assert.equal(out.status, 0, out.text);
  assert.match(out.text, /prune\?\s+merged \(merged\)/);
  assert.match(out.text, /prune\?\s+fresh \(fresh\)/);
  assert.match(out.text, /forget\?\s+gone \(gone\): folder gone/);
  assert.match(out.text, /ignored 1 worktree/);
  assert.match(out.text, /dry run: 2 worktree\(s\) would go/);
  assert.doesNotMatch(out.text, /conductor\/run/);
  assert.ok(existsSync(merged) && existsSync(fresh) && existsSync(app));
  assert.match(f.git(f.primary, "worktree", "list"), /gone/);
});

test("prune --yes removes only landed worktrees under .claude/worktrees, and their branches", (t) => {
  const f = fixture(t);
  const { merged, fresh, app } = layout(f);

  const out = f.prune("--yes");

  assert.equal(out.status, 0, out.text);
  assert.ok(!existsSync(merged) && !existsSync(fresh), out.text);
  assert.equal(f.git(f.primary, "branch", "--list", "merged", "fresh"), "");
  assert.doesNotMatch(f.git(f.primary, "worktree", "list"), /gone/);
  // The app-owned checkout is landed and clean, and still untouched.
  assert.ok(existsSync(app));
  assert.match(f.git(f.primary, "branch", "--list", "conductor/run"), /conductor\/run/);
  for (const [name, reason] of KEPT) {
    assert.match(out.text, new RegExp(`keep\\s+${name} .*${reason}`), name);
    assert.ok(existsSync(join(f.primary, ".claude/worktrees", name)), name);
  }
});

test("prune --yes removes nothing when origin main can't be fetched", (t) => {
  const f = fixture(t);
  const { merged, fresh } = layout(f);
  f.git(f.primary, "remote", "set-url", "origin", join(f.primary, "no-such-origin.git"));

  const out = f.prune("--yes");

  assert.notEqual(out.status, 0, out.text);
  assert.match(out.text, /removed nothing/);
  assert.ok(existsSync(merged) && existsSync(fresh), out.text);
});

/** A preview branch with one preview-only commit, and a feature branch off origin/main. */
function previewSetup(f) {
  const base = f.git(f.primary, "rev-parse", "origin/main");
  f.git(f.primary, "switch", "-q", "-c", "adhoc/example", "origin/main");
  f.git(f.primary, "commit", "-q", "--allow-empty", "-m", "feature");
  const feature = f.git(f.primary, "rev-parse", "HEAD");
  f.git(f.primary, "config", "--add", "preview.branch", "adhoc/example");
  return { base, feature, zero: "0".repeat(40) };
}

test("the preview guard refuses a preview branch by name or by its tip", (t) => {
  const f = fixture(t);
  const { base, zero } = previewSetup(f);
  f.git(f.primary, "switch", "-q", "--no-track", "-c", "preview/dev", "origin/main");
  f.git(f.primary, "merge", "-q", "--no-ff", "--no-edit", "adhoc/example");
  const tip = f.git(f.primary, "rev-parse", "HEAD");
  // A branch cut from the preview carries its merge commit, which no feature branch has.
  f.git(f.primary, "branch", "copy", "preview/dev");

  for (const line of [
    `refs/heads/preview/dev ${tip} refs/heads/preview/dev ${zero}`,
    `refs/heads/adhoc/x ${base} refs/heads/preview/dev ${zero}`,
    `HEAD ${tip} refs/heads/adhoc/example ${zero}`,
    `refs/heads/copy ${tip} refs/heads/copy ${zero}`,
  ]) {
    const out = f.guard([line]);
    assert.equal(out.status, 1, `${line}\n${out.text}`);
    assert.match(out.text, /preview\/\* branches are local-only/, line);
  }
  // Deleting a remote ref passes.
  assert.equal(f.guard([`(delete) ${zero} refs/heads/preview/dev ${tip}`]).status, 0);
});

test("the preview guard passes a feature whose tip the preview shares", (t) => {
  const f = fixture(t);
  const { base, feature, zero } = previewSetup(f);
  // Right after turn-on the preview sits at origin/main.
  f.git(f.primary, "switch", "-q", "--no-track", "-c", "preview/dev", "origin/main");
  const fresh = f.guard([`HEAD ${base} refs/heads/adhoc/new ${zero}`]);
  assert.equal(fresh.status, 0, fresh.text);
  // The first merge fast-forwards the preview onto the feature's tip.
  f.git(f.primary, "merge", "-q", "--no-edit", "adhoc/example");
  assert.equal(f.git(f.primary, "rev-parse", "HEAD"), feature);
  const out = f.guard([`refs/heads/adhoc/example ${feature} refs/heads/adhoc/example ${zero}`]);
  assert.equal(out.status, 0, out.text);
});

test("pre-push reads the pushed refs once and feeds the guard and the retired-terms loop", (t) => {
  const f = fixture(t);
  const { base, feature, zero } = previewSetup(f);
  const line = `refs/heads/adhoc/example ${feature} refs/heads/adhoc/example ${zero}`;

  const out = f.prePush([line]);

  assert.equal(out.status, 0, out.text);
  assert.match(out.log, /^node scripts\/check-preview-push\.mjs$/m);
  assert.ok(out.log.includes(`${line}\n`), out.log);
  assert.match(out.log, /^pnpm lint$/m);
  assert.match(out.log, new RegExp(`check-retired-terms\\.mjs --added-since ${base} --head ${feature}`));
  assert.match(out.log, /one-word-per-thing\/sweep\.mjs/);
});
