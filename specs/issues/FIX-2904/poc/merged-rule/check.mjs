#!/usr/bin/env node
/**
 * FIX-2904 factual-base check and merged-rule experiment.
 *
 * Two parts, both throwaway evidence. Neither is wired into CI or any default
 * discovery. Run from the repo root:
 *
 *   node specs/issues/FIX-2904/poc/merged-rule/check.mjs
 *   node specs/issues/FIX-2904/poc/merged-rule/check.mjs --plant
 *   node specs/issues/FIX-2904/poc/merged-rule/check.mjs --control ancestry-only
 *
 * PART 1, the counted facts SPEC.md rests on, re-derived from the source:
 *   F1  every commit on main's first-parent line is a merge commit (how this
 *       repository merges), over the last 500;
 *   F2  `git worktree remove` is run in exactly one place, and the callers of
 *       the host's `remove` are the ones the spec lists (totality: any other
 *       file that removes a worktree fails until someone classifies it);
 *   F3  only one source file writes a refreshed pull-request state onto a
 *       worktree row, and it runs at a turn's end;
 *   F4  the refusals `remove` can make are the four the spec names.
 *   `--plant` adds one synthetic file that removes a worktree. The check must
 *   exit 1 on it, or the totality assertion proves nothing.
 *
 * PART 2, the rule that says a worktree's work has merged, in disposable
 * repositories. Evidence is positive or the worktree is kept:
 *   A  a pull request on the branch is merged and the branch tip is that pull
 *      request's head or older (GitHub is stubbed here by a head commit);
 *   B  the tip is reachable from the default branch and is NOT on its
 *      first-parent line, so it arrived as the second parent of a merge.
 *   `--control ancestry-only` swaps the rule for "tip is reachable from the
 *   default branch". It must exit 1: it removes a fresh worker's branch and
 *   keeps a squash merge.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const plant = args.includes("--plant");
const control = args.includes("--control") ? args[args.indexOf("--control") + 1] : null;
const ROOT = process.cwd();
let failures = 0;
const expect = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};

/** Run git (no shell). Returns stdout, or throws. */
const git = (cwd, ...argv) => execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitOk = (cwd, ...argv) => {
  try {
    execFileSync("git", argv, { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

// ───────────────────────── PART 1 ─────────────────────────

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".next" || name === "test") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(p);
  }
  return out;
}

function sourceFiles() {
  const files = [];
  for (const group of ["packages", "labs"]) {
    for (const pkg of readdirSync(join(ROOT, group))) {
      const src = join(ROOT, group, pkg, "src");
      try {
        walk(src, files);
      } catch {
        // a package with no src
      }
    }
  }
  try {
    walk(join(ROOT, "apps/kitchen-sink/lib"), files);
  } catch {
    // none
  }
  return files.map((f) => ({ path: relative(ROOT, f), text: readFileSync(f, "utf8") }));
}

// F1
const base = gitOk(ROOT, "rev-parse", "--verify", "origin/main") ? "origin/main" : "main";
const parents = git(ROOT, "log", base, "--first-parent", "-500", "--format=%P").split("\n");
const single = parents.filter((line) => line.trim().split(/\s+/).filter(Boolean).length === 1).length;
expect(parents.length === 500 && single === 0, `F1 ${parents.length - single} of ${parents.length} first-parent commits on ${base} are merge commits (want all)`);

// F2: where a worktree is removed
const files = sourceFiles();
if (plant) files.push({ path: "packages/planted/src/sneaky.ts", text: 'await run("git", ["worktree", "remove", dir]);' });
const GIT_REMOVE = /\[\s*"worktree"\s*,\s*"remove"/;
const HOST_REMOVE = /\b(?:host|workspace|options\.workspace)\.remove!?\(/;
const SITES = {
  "packages/workspace/src/local-host.ts": { gitRemove: 1, hostRemove: 0 },
  "packages/harness-manager/src/session-flow.ts": { gitRemove: 0, hostRemove: 1 },
  "packages/fsdev/src/commands/worktrees.ts": { gitRemove: 0, hostRemove: 1 },
};
const seen = {};
for (const f of files) {
  const g = (f.text.match(new RegExp(GIT_REMOVE, "g")) ?? []).length;
  const h = (f.text.match(new RegExp(HOST_REMOVE, "g")) ?? []).length;
  if (g || h) seen[f.path] = { gitRemove: g, hostRemove: h };
}
const unclassified = Object.keys(seen).filter((p) => !(p in SITES));
const wrong = Object.entries(SITES).filter(([p, want]) => JSON.stringify(seen[p]) !== JSON.stringify(want));
expect(unclassified.length === 0, `F2 every file that removes a worktree is classified (unclassified: ${unclassified.join(", ") || "none"})`);
expect(wrong.length === 0, `F2 classified sites match: one git remove, two callers of the host's remove (off: ${wrong.map(([p]) => p).join(", ") || "none"})`);

// F3: writers of a refreshed pull-request state onto a row
const refreshers = files.filter((f) => /\baddWorktreePullRequests\(/.test(f.text) && !f.path.endsWith("worktrees.ts")).map((f) => f.path);
expect(refreshers.length === 1 && refreshers[0] === "packages/workspace/src/branch-pull-requests.ts", `F3 row pull-request state is refreshed by one file: ${refreshers.join(", ") || "none"}`);

// F4: refusals inside `remove`
const host = files.find((f) => f.path === "packages/workspace/src/local-host.ts")?.text ?? "";
const body = host.slice(host.indexOf("async function remove("), host.indexOf("async function attach("));
const reasons = [...new Set([...body.matchAll(/WorkspaceRefusedError\(\s*"([a-z-]+)"/g)].map((m) => m[1]))].sort();
expect(JSON.stringify(reasons) === JSON.stringify(["in-use", "place-busy", "uncommitted-work", "unique-commits"]), `F4 remove refuses as: ${reasons.join(", ")}`);

// ───────────────────────── PART 2 ─────────────────────────

const scratch = mkdtempSync(join(tmpdir(), "merged-rule-"));
try {
  const remote = join(scratch, "remote.git");
  const repo = join(scratch, "repo");
  git(scratch, "init", "-q", "--bare", "-b", "main", remote);
  git(scratch, "init", "-q", "-b", "main", repo);
  for (const [k, v] of [["user.email", "a@b.c"], ["user.name", "t"], ["commit.gpgsign", "false"]]) git(repo, "config", k, v);
  const commit = (cwd, file, msg) => {
    writeFileSync(join(cwd, file), `${msg}\n`);
    git(cwd, "add", file);
    git(cwd, "commit", "-q", "-m", msg);
    return git(cwd, "rev-parse", "HEAD");
  };
  commit(repo, "base.txt", "base");
  const oldTip = git(repo, "rev-parse", "HEAD");
  git(repo, "remote", "add", "origin", remote);

  // Where each branch was cut: what a row's baseCommit records.
  const cut = {};
  // A branch at the old tip with no commits: a worker that has just started.
  git(repo, "branch", "fresh", oldTip);
  cut.fresh = oldTip;

  // Merged by a merge commit.
  git(repo, "checkout", "-q", "-b", "merged-commit");
  cut["merged-commit"] = oldTip;
  const mcTip = commit(repo, "mc.txt", "mc work");
  git(repo, "checkout", "-q", "main");
  git(repo, "merge", "-q", "--no-ff", "-m", "Merge pull request #1", "merged-commit");

  // Merged by squash: the branch's own commits never reach main.
  git(repo, "checkout", "-q", "-b", "merged-squash", oldTip);
  cut["merged-squash"] = oldTip;
  const sqTip = commit(repo, "sq.txt", "sq work");
  git(repo, "checkout", "-q", "main");
  git(repo, "merge", "-q", "--squash", "merged-squash");
  git(repo, "commit", "-q", "-m", "sq work (#2)");

  // Squash-merged, then the worker kept going: the tip is past the pull request's head.
  git(repo, "checkout", "-q", "-b", "squash-then-more", oldTip);
  cut["squash-then-more"] = oldTip;
  const sqmHead = commit(repo, "sqm.txt", "sqm work");
  git(repo, "checkout", "-q", "main");
  git(repo, "merge", "-q", "--squash", "squash-then-more");
  git(repo, "commit", "-q", "-m", "sqm work (#4)");
  git(repo, "checkout", "-q", "squash-then-more");
  commit(repo, "sqm2.txt", "after the squash");
  git(repo, "checkout", "-q", "main");

  // Rebase-merged: the same change replayed onto main with a new id. GitHub's head is the branch tip.
  git(repo, "checkout", "-q", "-b", "merged-rebase", oldTip);
  cut["merged-rebase"] = oldTip;
  const rbTip = commit(repo, "rb.txt", "rb work");
  git(repo, "checkout", "-q", "main");
  git(repo, "cherry-pick", "-n", rbTip);
  git(repo, "commit", "-q", "-m", "rb work (#5)");

  // Stacked: a worker cut at another branch's tip, which then merged by a merge commit.
  git(repo, "checkout", "-q", "-b", "stack-base", oldTip);
  cut["stack-base"] = oldTip;
  const sbTip = commit(repo, "sb.txt", "stack-base work");
  git(repo, "branch", "stacked-fresh", sbTip);
  cut["stacked-fresh"] = sbTip;
  git(repo, "checkout", "-q", "main");
  git(repo, "merge", "-q", "--no-ff", "-m", "Merge pull request #6", "stack-base");

  // Merged by a merge commit, then the worker kept going.
  git(repo, "checkout", "-q", "-b", "merged-then-more", oldTip);
  cut["merged-then-more"] = oldTip;
  commit(repo, "mm.txt", "mm work");
  git(repo, "checkout", "-q", "main");
  git(repo, "merge", "-q", "--no-ff", "-m", "Merge pull request #3", "merged-then-more");
  git(repo, "checkout", "-q", "merged-then-more");
  const mmTip = commit(repo, "mm2.txt", "after the merge");
  git(repo, "checkout", "-q", "main");

  // Merged by fast-forward (a local landing that happened to fast-forward).
  git(repo, "checkout", "-q", "-b", "merged-ff");
  cut["merged-ff"] = git(repo, "rev-parse", "HEAD");
  commit(repo, "ff.txt", "ff work");
  git(repo, "checkout", "-q", "main");
  git(repo, "merge", "-q", "--ff-only", "merged-ff");

  git(repo, "push", "-q", "origin", "main");
  const tipOf = (b) => git(repo, "rev-parse", `refs/heads/${b}`);
  // What GitHub would say: pull request #2's head is the squash branch's tip.
  const pullRequests = {
    "merged-squash": { merged: true, head: sqTip },
    "merged-commit": { merged: true, head: mcTip },
    "squash-then-more": { merged: true, head: sqmHead },
    "merged-rebase": { merged: true, head: rbTip },
  };

  const isAncestor = (a, b) => gitOk(repo, "merge-base", "--is-ancestor", a, b);
  const onFirstParent = (tip, ref) => git(repo, "rev-list", "--first-parent", ref).split("\n").includes(tip);

  /** Positive evidence only; anything unproven is kept. */
  function merged(branch) {
    const tip = tipOf(branch);
    if (control === "ancestry-only") return isAncestor(tip, "main");
    const pr = pullRequests[branch];
    // A branch needs a commit of its own past where it was cut.
    if (control !== "no-own-commit-check" && control !== "pr-merged-only" && (!cut[branch] || tip === cut[branch])) return false;
    // A control: "the pull request is merged" alone.
    if (control === "pr-merged-only") return pr?.merged ? "A" : false;
    if (pr?.merged && gitOk(repo, "cat-file", "-e", `${pr.head}^{commit}`) && (tip === pr.head || isAncestor(tip, pr.head))) return "A";
    if (isAncestor(tip, "main") && !onFirstParent(tip, "main")) return "B";
    return false;
  }

  const WANT = {
    fresh: false, // a worker's start reads as reachable from main; nothing says it merged
    "merged-commit": true,
    "merged-squash": true,
    "merged-then-more": false, // commits past the merge
    "merged-ff": false, // fast-forward leaves no merge to see: kept, the safe direction
    "merged-rebase": true,
    "squash-then-more": false, // the tip is past the pull request's head
    "stacked-fresh": false, // its tip is another branch's merged tip, not its own work
    "stack-base": true,
  };
  for (const [branch, want] of Object.entries(WANT)) {
    const got = Boolean(merged(branch));
    expect(got === want, `rule${control ? ` (${control})` : ""}: ${branch} -> ${got ? "removed" : "kept"} (want ${want ? "removed" : "kept"})`);
  }
  void mmTip;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
