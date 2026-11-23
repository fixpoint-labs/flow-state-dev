#!/usr/bin/env node
/**
 * FIX-2905 experiment: a preview that is a separate local clone with no
 * remote, which merges every in-flight branch, cannot push, and rebuilds only over its
 * own work.
 *
 * Throwaway evidence, in disposable repositories. Not wired into CI or any default
 * discovery. Run from anywhere:
 *
 *   node specs/issues/FIX-2905/poc/preview-worktree/check.mjs
 *   node specs/issues/FIX-2905/poc/preview-worktree/check.mjs --control hook-guard
 *
 * What it settles (each a claim the spec rests on):
 *   P1  the preview's branch has no upstream and the clone has no remote;
 *   P2  every push from the preview is refused, whatever the target: HEAD to another
 *       name, the branch by name, another local branch, a typed URL, a remote added
 *       later, and `--no-verify`; a sibling worktree and the primary still push;
 *   P3  the control: `--control hook-guard` swaps the config guard for a pre-push hook
 *       and must exit 1, because `--no-verify` walks past a hook;
 *   P4  merging in-flight branches in turn leaves out the one that conflicts, naming
 *       the files and the branches already merged, and the rest merge, their own files
 *       on disk; a branch with no commits of its own (a fresh worker) is already
 *       contained; a worker's new commit is picked up by the next rebuild;
 *   P5  a hand resolution made with plain `git merge` and `git commit` in the preview is
 *       replayed on rebuild, and nothing lands in the primary's rerere cache;
 *   P6  the rebuild guard: reset --hard only when HEAD is the tip the last build made
 *       and the tree is clean;
 *   P7  the primary's HEAD, status, branch list and repository config are unchanged,
 *       and the clone is the only thing added;
 *   P8  the same holds when the source is a bare repository with worktrees.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const control = args.includes("--control") ? args[args.indexOf("--control") + 1] : null;
let failures = 0;
const expect = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};
const git = (cwd, ...argv) => execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const ok = (cwd, ...argv) => {
  try {
    execFileSync("git", argv, { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const out = (cwd, ...argv) => {
  try {
    return { ok: true, text: git(cwd, ...argv) };
  } catch (e) {
    return { ok: false, text: String(e.stderr ?? e.message) };
  }
};
const identity = (cwd) => {
  for (const [k, v] of [["user.email", "a@b.c"], ["user.name", "t"], ["commit.gpgsign", "false"]]) git(cwd, "config", "--local", k, v);
};
const put = (cwd, file, text, msg) => {
  writeFileSync(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", msg);
};

/** The preview: a clone of `source` with no remote, and (unless the control) no push address. */
function makePreview(source, dest) {
  git(dirOf(dest), "clone", "-q", "--local", "--no-checkout", source, dest);
  identity(dest);
  git(dest, "remote", "remove", "origin");
  if (control === "hook-guard") {
    // The control keeps a remote, and guards with a pre-push hook, as the rejected design did.
    git(dest, "remote", "add", "origin", join(S, "remote.git"));
    const hooks = join(dest, ".git", "hooks");
    writeFileSync(join(hooks, "pre-push"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  } else {
    git(dest, "config", "--local", "url.disabled://no-push/.pushInsteadOf", "");
  }
  git(dest, "config", "--local", "rerere.enabled", "true");
  git(dest, "config", "--local", "rerere.autoupdate", "true");
}
const dirOf = (p) => p.slice(0, p.lastIndexOf("/"));

/** One build: reset to the base, then merge each live branch in turn. Returns what merged and what was left out. */
function build(source, preview, baseRef, live) {
  git(preview, "fetch", "-q", source, `+${baseRef}:refs/preview/base`);
  for (const f of live) git(preview, "fetch", "-q", source, `+refs/heads/feature/${f}:refs/preview/live/${f}`);
  git(preview, "checkout", "-q", "-B", "preview", "refs/preview/base");
  const merged = [];
  const left = [];
  for (const f of live) {
    const ref = `refs/preview/live/${f}`;
    if (ok(preview, "merge-base", "--is-ancestor", ref, "HEAD")) {
      merged.push(f); // already contained: a branch with no commits of its own
      continue;
    }
    const r = out(preview, "merge", "--no-ff", "--no-edit", ref);
    if (r.ok) merged.push(f);
    else if (git(preview, "diff", "--name-only", "--diff-filter=U") === "") {
      // rerere replayed a recorded resolution and staged it: finish the merge.
      const done = out(preview, "commit", "--no-edit");
      if (done.ok) merged.push(f);
      else {
        git(preview, "merge", "--abort");
        left.push({ f, files: [], after: [...merged] });
      }
    } else {
      const files = git(preview, "diff", "--name-only", "--diff-filter=U").split("\n");
      git(preview, "merge", "--abort");
      left.push({ f, files, after: [...merged] });
    }
  }
  git(preview, "config", "--local", "fsd.builtTip", git(preview, "rev-parse", "HEAD"));
  return { merged, left };
}

const S = mkdtempSync(join(tmpdir(), "preview-"));
const P = (name) => join(S, name);
try {
  git(S, "init", "-q", "--bare", "-b", "main", "remote.git");
  git(S, "init", "-q", "-b", "main", "primary");
  const primary = P("primary");
  identity(primary);
  put(primary, "shared.txt", "line\n", "base");
  git(primary, "remote", "add", "origin", P("remote.git"));
  git(primary, "push", "-q", "origin", "main");
  git(primary, "fetch", "-q", "origin");

  // Four in-flight features, cut as workers' worktrees are: fa and fb are independent,
  // fc edits what fa edits, fd is a worker that has just started (no commits of its own).
  for (const f of ["fa", "fb", "fc", "fd"]) git(primary, "worktree", "add", "-q", "--no-track", "-b", `feature/${f}`, P(f), "origin/main");
  put(P("fa"), "shared.txt", "line\nfrom fa\n", "fa edits shared");
  put(P("fb"), "b.txt", "b\n", "fb adds b");
  put(P("fc"), "shared.txt", "line\nfrom fc\n", "fc edits shared");

  // The baseline is taken before anything is made for the preview.
  const snapshot = () => ({
    head: git(primary, "rev-parse", "HEAD"),
    status: git(primary, "status", "--porcelain"),
    branches: git(primary, "branch", "--list"),
    config: git(primary, "config", "--local", "--list"),
    rrCache: existsSync(join(primary, ".git", "rr-cache")),
    worktrees: git(primary, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).join("\n"),
  });
  const before = snapshot();

  const live = ["fa", "fb", "fc", "fd"];
  const preview = P("preview");
  makePreview(primary, preview);
  const first = build(primary, preview, "refs/remotes/origin/main", live);

  // P1
  const hasRemote = git(preview, "remote") !== "";
  const hasUpstream = ok(preview, "config", "--get", "branch.preview.remote");
  expect(control === "hook-guard" || (!hasRemote && !hasUpstream), "P1 the preview has no remote and its branch has no upstream");

  // P2 / P3
  const pushes = [
    ["origin", "HEAD:refs/heads/leak-head", "HEAD to another name"],
    ["origin", "preview:refs/heads/leak-name", "the preview branch by name"],
    ["origin", "refs/preview/live/fb:refs/heads/leak-feature", "another local branch"],
    [P("remote.git"), "HEAD:refs/heads/leak-url", "a typed URL"],
  ];
  if (control !== "hook-guard") git(preview, "remote", "add", "origin", P("remote.git")); // a remote someone adds later
  for (const [target, spec, label] of pushes) {
    const r = out(preview, "push", target, spec);
    expect(r.ok === false, `P2 push from the preview is refused: ${label}${control ? ` (${control})` : ""}`);
  }
  const nv = out(preview, "push", "--no-verify", "origin", "HEAD:refs/heads/leak-noverify");
  expect(nv.ok === false, `P2 push --no-verify from the preview is refused${control ? ` (${control})` : ""}`);
  const sib = out(P("fb"), "push", "origin", "HEAD:refs/heads/ok-sibling");
  const prim = out(primary, "push", "origin", "HEAD:refs/heads/ok-primary");
  expect(sib.ok && prim.ok, "P2 a sibling worktree and the primary checkout still push");
  const leaked = git(P("remote.git"), "branch", "--list", "leak-*");
  expect(leaked === "", `P2 the remote holds no leaked branch${leaked ? ` (found: ${leaked.replace(/\s+/g, " ")})` : ""}`);
  if (control !== "hook-guard") git(preview, "remote", "remove", "origin");

  // P4
  expect(
    first.merged.join() === "fa,fb,fd" && first.left.length === 1 && first.left[0].f === "fc" && first.left[0].files.join() === "shared.txt" && first.left[0].after.join() === "fa,fb",
    `P4 merged ${first.merged.join("+")}; left out ${first.left.map((l) => `${l.f} (${l.files}) after ${l.after}`).join()}`,
  );
  expect(live.filter((f) => !first.left.some((l) => l.f === f)).every((f) => ok(preview, "merge-base", "--is-ancestor", `refs/preview/live/${f}`, "HEAD")), "P4 every merged branch's tip is an ancestor of the preview's HEAD");

  expect(existsSync(join(preview, "b.txt")) && git(preview, "show", "HEAD:shared.txt").includes("from fa"), "P4 each merged branch's own file is in the preview's tree");

  // P6: the rebuild guard.
  const builtTip = () => git(preview, "config", "--local", "--get", "fsd.builtTip");
  const clean = () => git(preview, "status", "--porcelain") === "";
  const mayRebuild = () => git(preview, "rev-parse", "HEAD") === builtTip() && clean();
  expect(mayRebuild() === true, "P6 a rebuild is allowed when HEAD is the tip the last build made and the tree is clean");

  // P5: a person resolves fc by hand in the preview, with plain git; a rebuild replays it.
  out(preview, "merge", "--no-ff", "--no-edit", "refs/preview/live/fc");
  writeFileSync(join(preview, "shared.txt"), "line\nfrom fa\nfrom fc\n");
  git(preview, "add", "shared.txt");
  git(preview, "commit", "-q", "--no-edit");
  expect(mayRebuild() === false, "P6 rebuild refuses when the preview holds a commit the last build did not make");
  // After an explicit discard, the rebuild resets and merges again.
  const second = build(primary, preview, "refs/remotes/origin/main", live);
  expect(second.merged.join() === "fa,fb,fc,fd" && second.left.length === 0, `P5 after a discard-and-rebuild, rerere replays the hand resolution: merged ${second.merged.join("+") || "nothing"}`);
  expect(mayRebuild() === true, "P6 a rebuild is allowed again once HEAD is the tip the last build made and the tree is clean");

  // A worker commits again; a rebuild with no hand commit succeeds and reads the new tip.
  put(P("fb"), "b3.txt", "b3\n", "fb moves");
  expect(mayRebuild() === true, "P6 a rebuild with no hand commit is allowed");
  const third = build(primary, preview, "refs/remotes/origin/main", live);
  expect(third.merged.includes("fb") && existsSync(join(preview, "b3.txt")) && ok(preview, "merge-base", "--is-ancestor", git(P("fb"), "rev-parse", "HEAD"), "HEAD"), "P4 after a worker commits, a rebuild picks up the new tip");

  // P7
  const after = snapshot();
  expect(
    after.head === before.head && after.status === before.status && after.branches === before.branches && after.worktrees === before.worktrees,
    "P7 the primary checkout's HEAD, status, branch list and worktree list are unchanged",
  );
  const addedKeys = after.config.split("\n").filter((l) => !before.config.split("\n").includes(l));
  expect(addedKeys.length === 0 && after.rrCache === false, `P7 no repository-config key and no rerere cache is added to the primary${addedKeys.length ? ` (added: ${addedKeys.join(", ")})` : ""}`);

  // P8: the source is a bare repository with worktrees, as the host's own clones are.
  const bare = P("clone.git");
  git(S, "clone", "-q", "--bare", P("remote.git"), bare);
  git(bare, "config", "--local", "user.email", "a@b.c");
  git(bare, "config", "--local", "user.name", "t");
  git(bare, "worktree", "add", "-q", "--no-track", "-b", "feature/fa", P("bw-fa"), "main");
  git(bare, "worktree", "add", "-q", "--no-track", "-b", "feature/fb", P("bw-fb"), "main");
  identity(P("bw-fa"));
  identity(P("bw-fb"));
  put(P("bw-fa"), "a.txt", "a\n", "bw fa");
  put(P("bw-fb"), "b2.txt", "b\n", "bw fb");
  const barePreview = P("bare-preview");
  makePreview(bare, barePreview);
  const bareBuild = build(bare, barePreview, "refs/heads/main", ["fa", "fb"]);
  const workerOk = out(P("bw-fa"), "status", "--porcelain").ok && out(bare, "rev-parse", "--is-bare-repository").text === "true";
  const barePush = out(barePreview, "push", P("remote.git"), "HEAD:refs/heads/leak-bare");
  expect(bareBuild.merged.join() === "fa,fb" && workerOk && barePush.ok === false, `P8 a preview of a bare repository merges ${bareBuild.merged.join("+")}, the workers' worktrees still work, and its pushes are refused${control ? ` (${control})` : ""}`);
} finally {
  rmSync(S, { recursive: true, force: true });
}
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
void mkdirSync;
