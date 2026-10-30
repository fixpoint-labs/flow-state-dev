#!/usr/bin/env node
/**
 * Codemod: goals stop naming a seat or a mailbox (FIX-2248).
 *
 * Moves each goal folder whose name says seat or mailbox to the name that
 * says worker or coordinator (`git mv`, so history follows), then rewrites
 * every reference to a moved folder in the tracked tree. One goal that says
 * "person" for the signed-in user moves with them, since the guard that kept
 * goal names (`check-retired-terms`'s `goal-names` exception) goes in the same
 * change.
 *
 * What it leaves as written:
 * - History (`specs/`, `docs/internal/`, changelogs, changesets: the guard's
 *   `history` area), and every `goal.md`'s `## Verdict log` section. Dated
 *   records keep the names they ran under. One file under `specs/` is a live
 *   check, not a record: FIX-1792's inventory, whose goal table
 *   `coordinators/every-coordinator-is-a-worker-file` resolves on disk, so it
 *   is rewritten.
 * - A goal that no longer exists. A renamed subject folder's name is rewritten
 *   only when it stands alone or is followed by one of its own entries, so
 *   `goals/README.md`'s list of retired goals (`mailbox-boards/it-hands-a-task-to-a-fresh-hire`)
 *   keeps naming what was retired.
 * - The retired-terms guard and its test. Their goal paths are planted
 *   examples, not references to a goal.
 *
 * Run on a clean checkout of `main`: node scripts/codemod/rename-seat-mailbox-goals.mjs
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { areaOf } from "../check-retired-terms.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Subject folders (the `describe` level), old name → new name. */
const DESCRIBES = {
  "mailbox-boards": "coordinator-boards",
  "multi-seat-collab": "multi-worker-collab",
  "workforce-mailboxes": "workforce-coordinators",
  "workforce-seats": "workforce-workers",
};

/** Behaviour folders (the `it` level), old name → new name. Each name is unique in `goals/`. */
const ITS = {
  "it-commits-from-the-seats-own-file": "it-commits-from-the-workers-own-file",
  "it-keeps-its-rows-on-the-mailboxes-board": "it-keeps-its-rows-on-the-coordinators-board",
  "it-wakes-the-seat-a-file-declared": "it-wakes-the-worker-a-file-declared",
  "it-ships-an-artifact-a-person-can-open": "it-ships-an-artifact-a-user-can-open",
  "refuses-a-board-drain-onto-a-seat-it-is-outside": "refuses-a-board-drain-onto-a-worker-it-is-outside",
  "a-person-talks-to-a-seat-a-mailbox-and-back": "a-user-talks-to-a-worker-a-coordinator-and-back",
  "agent-replies-in-the-mailbox": "agent-replies-in-the-coordinator",
  "it-routes-a-queue-to-the-seats-their-files-name": "it-routes-a-queue-to-the-workers-their-files-name",
  "it-hands-a-row-between-two-seats-in-view": "it-hands-a-row-between-two-workers-in-view",
  "a-post-reaches-both-declared-seats": "a-post-reaches-both-declared-workers",
  "a-seat-answers-from-its-own-document": "a-worker-answers-from-its-own-document",
  "it-sends-a-turn-into-a-seat-session": "it-sends-a-turn-into-a-worker-session",
  "a-team-says-once-what-its-seats-are-told": "a-team-says-once-what-its-workers-are-told",
  "a-callers-own-agent-wins-every-seat": "a-callers-own-agent-wins-every-worker",
  "a-non-agent-seat-receives-its-skills": "a-non-agent-worker-receives-its-skills",
  "a-seat-reaches-the-documents-its-file-names": "a-worker-reaches-the-documents-its-file-names",
};

/** A file in the history area that a goal runs, so its goal paths must follow the moves. */
const LIVE = new Set(["specs/issues/FIX-1792/poc/inventory/check.mjs"]);

/** This file, and files whose goal paths are planted examples. */
const LEAVE = new Set([
  "scripts/codemod/rename-seat-mailbox-goals.mjs",
  "scripts/check-retired-terms.mjs",
  "packages/core/test/retired-terms-check.test.ts",
]);

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tracked = () => git("ls-files", "-z").split("\0").filter(Boolean);

// ---- what each renamed subject folder holds, read before anything moves ------
const before = tracked();
/** @type {Record<string, Set<string>>} */
const entries = {};
for (const d of Object.keys(DESCRIBES)) {
  entries[d] = new Set(before.filter((p) => p.startsWith(`goals/${d}/`)).map((p) => p.split("/")[2]));
  if (entries[d].size === 0) throw new Error(`goals/${d}/ is not in the tree: run this on a checkout that still has it`);
}
for (const it of Object.keys(ITS)) {
  const found = new Set(before.filter((p) => p.split("/")[2] === it).map((p) => p.split("/").slice(0, 3).join("/")));
  if (found.size !== 1) throw new Error(`goals/*/${it} found ${found.size} times, expected once`);
}

// ---- the moves ---------------------------------------------------------------
for (const [from, to] of Object.entries(DESCRIBES)) git("mv", `goals/${from}`, `goals/${to}`);
for (const path of new Set(tracked().map((p) => p.split("/").slice(0, 3).join("/")))) {
  const [top, describe, it] = path.split("/");
  if (top === "goals" && ITS[it] !== undefined) git("mv", path, `goals/${describe}/${ITS[it]}`);
}

// ---- the references ------------------------------------------------------------
/** @type {Array<[RegExp, string]>} */
const rewrites = [];
for (const [from, to] of Object.entries(DESCRIBES)) {
  // `<describe>/<one of its own entries>`, with the entry renamed too when it is an `it`.
  for (const entry of entries[from]) {
    rewrites.push([new RegExp(`(?<![\\w-])${escape(from)}/${escape(entry)}(?![\\w-])`, "g"), `${to}/${ITS[entry] ?? entry}`]);
  }
  // The subject alone, never followed by an entry it does not hold.
  rewrites.push([new RegExp(`(?<![\\w-])${escape(from)}(?![\\w-])(?!/[\\w-])`, "g"), to]);
}
for (const [from, to] of Object.entries(ITS)) rewrites.push([new RegExp(`(?<![\\w-])${escape(from)}(?![\\w-])`, "g"), to]);

const rewrite = (text) => rewrites.reduce((out, [re, to]) => out.replace(re, to), text);

/** Rewrite a `goal.md` outside its `## Verdict log` section. */
function rewriteGoal(text) {
  let inLog = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^#{1,2} /.test(line)) inLog = /^## Verdict log\b/.test(line);
      return inLog ? line : rewrite(line);
    })
    .join("\n");
}

const BINARY = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|pdf|zip|gz|mp4|webm|wasm|bundle)$/i;
let changed = 0;
for (const path of tracked()) {
  if (LEAVE.has(path) || BINARY.test(path) || (areaOf(path)?.id === "history" && !LIVE.has(path))) continue;
  const file = join(ROOT, path);
  if (!lstatSync(file, { throwIfNoEntry: false })?.isFile()) continue;
  const text = readFileSync(file, "utf8");
  if (text.includes("\0")) continue;
  const next = path.startsWith("goals/") && path.endsWith("/goal.md") ? rewriteGoal(text) : rewrite(text);
  if (next !== text) {
    writeFileSync(file, next);
    changed += 1;
  }
}
console.log(`moved ${Object.keys(DESCRIBES).length} subject folders and ${Object.keys(ITS).length} goals; rewrote references in ${changed} files`);
