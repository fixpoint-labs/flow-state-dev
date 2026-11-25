#!/usr/bin/env node
/**
 * Worktree housekeeping for agent sessions.
 *
 * `prune` reclaims the disk that finished agent worktrees hold. It only considers worktrees
 * under `<primary>/.claude/worktrees/`, where Agent sub-sessions with worktree isolation land.
 * Every other worktree (the run checkouts apps create under `.fsdev/` or the user's state
 * directory) belongs to the app that made it and is never touched.
 *
 * On its own it lists what it would do. With `--yes` it removes each worktree whose work is
 * already in `origin/main`, deletes that worktree's branch, and forgets worktrees whose folder
 * is gone. The preview-mode skill (`.agents/skills/preview-mode/`) runs it at every sync.
 *
 * Usage: node scripts/worktree.mjs prune [--yes]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const BASE = "origin/main";

/** Run git and return its trimmed stdout; throws on a non-zero exit. */
function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** The real path of `path` (symlinks resolved), or `path` itself when it does not exist. */
function realPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** True when git exits 0. */
function gitOk(args, cwd) {
  try {
    git(args, cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every worktree git knows about, from `git worktree list --porcelain`. The first record is
 * the primary checkout.
 */
function worktreeRows() {
  const rows = [];
  for (const block of git(["worktree", "list", "--porcelain"]).split("\n\n")) {
    const row = { path: "", head: "", branch: null, locked: false, primary: rows.length === 0 };
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) row.path = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) row.head = line.slice("HEAD ".length);
      else if (line.startsWith("branch ")) row.branch = line.slice("branch refs/heads/".length);
      else if (line === "locked" || line.startsWith("locked ")) row.locked = true;
    }
    if (row.path) rows.push(row);
  }
  return rows;
}

/** Branches the preview coordinator has listed (`git config --add preview.branch <b>`). */
function previewBranches(primary) {
  try {
    return new Set(git(["config", "--get-all", "preview.branch"], primary).split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Branches and worktree paths a lifecycle coordinator's handle cache names. The cache is
 * gitignored working memory under `<primary>/.orchestration/` (`<ISSUE>.md`, or
 * `<EPIC>/epic.md`); `issue-lifecycle` → "Handle cache" lists its branch and worktree path, as
 * lines such as `branch: fix/fix-123`, `- branch: spec/FIX-1` and `worktree: <path>`. Issue and
 * epic lifecycles reclaim their own worktrees, so prune leaves anything they name to them.
 * Over-matching only keeps more, which is the safe direction.
 */
function lifecycleClaims(primary) {
  const branches = new Set();
  const paths = new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".md")) {
        const text = readFileSync(path, "utf8");
        for (const match of text.matchAll(/\bbranch:?\s+([\w./-]+)/g)) {
          if (match[1] !== "-") branches.add(match[1]);
        }
        for (const match of text.matchAll(/\bworktree:\s+(\S+)/g)) {
          if (match[1] !== "-") paths.add(realPath(resolve(primary, match[1])));
        }
      }
    }
  };
  walk(join(primary, ".orchestration"));
  return { branches, paths };
}

/**
 * Why a worktree must stay, or null when it is safe to remove: nothing uncommitted, and its
 * commits already in `keep.base`, the origin/main commit this run fetched.
 */
function keepReason(row, keep) {
  if (row.path === keep.current) return "the checkout this ran from";
  if (row.locked) return "locked (an agent session is running in it)";
  if (row.branch && keep.preview.has(row.branch)) return "listed in preview.branch";
  if ((row.branch && keep.lifecycle.branches.has(row.branch)) || keep.lifecycle.paths.has(realPath(row.path))) {
    return "named in an .orchestration handle cache";
  }
  if (git(["status", "--porcelain"], row.path) !== "") return "uncommitted changes";
  if (gitOk(["merge-base", "--is-ancestor", row.head, keep.base])) return null;
  return row.branch === null ? `detached with commits not in ${BASE}` : `commits not in ${BASE}`;
}

/** Size of a directory tree in KiB (`du -sk`), or 0 when it can't be read. */
function sizeKiB(path) {
  try {
    return Number(execFileSync("du", ["-sk", path], { encoding: "utf8" }).split("\t")[0]) || 0;
  } catch {
    return 0;
  }
}

function formatKiB(kib) {
  if (kib >= 1024 * 1024) return `${(kib / 1024 / 1024).toFixed(1)} GB`;
  if (kib >= 1024) return `${(kib / 1024).toFixed(1)} MB`;
  return `${kib} KB`;
}

function cmdPrune(args) {
  const remove = args.includes("--yes");
  // Judge against the commit this fetch wrote to FETCH_HEAD (which is per worktree), not the
  // shared origin/main name another worktree could move between the fetch and the check.
  let base;
  if (gitOk(["fetch", "--quiet", "origin", "main"])) {
    base = git(["rev-parse", "FETCH_HEAD"]);
  } else if (remove) {
    console.error("could not fetch origin main, so nothing is proven landed; removed nothing");
    process.exit(1);
  } else {
    console.log(`warning: could not fetch origin main; judging against the local ${BASE}`);
    base = git(["rev-parse", BASE]);
  }
  const rows = worktreeRows();
  if (rows.length === 0) {
    console.error("git listed no worktrees; run this inside the repository");
    process.exit(1);
  }
  const primary = rows[0].path;
  const root = join(primary, ".claude", "worktrees") + sep;
  const keep = {
    current: git(["rev-parse", "--show-toplevel"]),
    preview: previewBranches(primary),
    lifecycle: lifecycleClaims(primary),
    base,
  };
  const label = (row) => `${row.path.slice(root.length)} (${row.branch ?? "detached"})`;

  let ignored = 0;
  let freed = 0;
  let candidates = 0;
  for (const row of rows) {
    if (row.primary) continue;
    if (!row.path.startsWith(root)) {
      ignored += 1;
      continue;
    }
    if (!existsSync(row.path) || !statSync(row.path).isDirectory()) {
      if (row.locked) {
        console.log(`keep    ${label(row)}: folder gone, but locked`);
        continue;
      }
      // --force is what lets git drop the record of a worktree whose folder is missing.
      console.log(`${remove ? "forget " : "forget?"} ${label(row)}: folder gone`);
      if (remove) git(["worktree", "remove", "--force", row.path]);
      continue;
    }
    const reason = keepReason(row, keep);
    if (reason !== null) {
      console.log(`keep    ${label(row)}: ${reason}`);
      continue;
    }
    const size = sizeKiB(row.path);
    if (remove) {
      try {
        // No --force: git refuses a worktree it finds unsafe to drop, and it stays.
        git(["worktree", "remove", row.path]);
      } catch (error) {
        console.log(`keep    ${label(row)}: git refused removal: ${String(error.stderr ?? error).trim()}`);
        continue;
      }
      if (row.branch !== null) {
        const tip = gitOk(["rev-parse", "--verify", "--quiet", `refs/heads/${row.branch}`])
          ? git(["rev-parse", `refs/heads/${row.branch}`])
          : row.head;
        if (tip !== row.head) {
          // The branch moved after it was judged landed; its new tip is unjudged, so it stays.
          console.log(`keep    branch ${row.branch}: moved since it was checked`);
        } else {
          // -D, not -d: keepReason already found the tip in origin/main, while -d judges against
          // this checkout's HEAD or the branch's upstream and refuses branches that have landed.
          git(["branch", "-D", row.branch]);
        }
      }
    }
    candidates += 1;
    freed += size;
    console.log(`${remove ? "removed" : "prune? "} ${label(row)}, ${formatKiB(size)}`);
  }

  console.log(`\nignored ${ignored} worktree(s) outside .claude/worktrees/ (app-owned; never touched)`);
  if (remove) console.log(`removed ${candidates} worktree(s), freed ${formatKiB(freed)}`);
  else console.log(`dry run: ${candidates} worktree(s) would go, freeing ${formatKiB(freed)}. \`pnpm wt:prune --yes\` removes them.`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "prune") {
  cmdPrune(rest);
} else {
  console.error("usage: node scripts/worktree.mjs prune [--yes]");
  process.exit(1);
}
