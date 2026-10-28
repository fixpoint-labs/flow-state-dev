/**
 * Codemod: FIX-2244, the chief of staff is the Shift Coordinator in code too.
 *
 * The worker id `chief-of-staff` becomes `shift-coordinator`, `chiefOfStaff*` and
 * `ChiefOfStaff*` become `shiftCoordinator*` and `ShiftCoordinator*`, and Shift
 * Manager's `cos` route, test ids and every `cos` spelling derived from them follow.
 * The head names are the contract in `specs/epics/FIX-2071/renames.md`. The old id
 * stops working: no alias, no second spelling read (D1).
 *
 * No old name here collides with a live one (`Cost`, `COST`, `cosine` and
 * `Math.cos` are not matched), so a text pass is the whole rename and no type
 * checker is needed:
 *
 * 1. **Paths.** Every tracked file whose path names the old id or a `cos` spelling
 *    moves with `git mv`, so history follows.
 * 2. **Text.** Code, tests, goals, labs, apps and the published docs. Retained specs,
 *    changelogs, `docs/internal` and a goal's dated verdict rows are history, a look
 *    check's `has: "…"` quotes design v2 as written, and the vocabulary sweep names
 *    the old words on purpose.
 *
 * Usage: `pnpm tsx scripts/codemod/rename-chief-of-staff.ts`. Re-run on a fresh
 * `main` to regenerate a conflicting PR (FIX-2071 ER-2). Hand edits that follow it
 * are their own commit.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });

/** Where the text pass reads. */
const TEXT_PATHS = ["packages", "apps/docs/docs", "apps/docs/guides", "apps/kitchen-sink", "apps/devtool", "goals", "labs", "examples", "docs/architecture"];
const TEXT_EXCLUDES = [":!**/CHANGELOG.md", ":!**/node_modules/**", ":!**/dist/**", ":!goals/vocabulary/one-word-per-thing/**"];

/** Where `cos` is Shift Manager's short name for the chief of staff. Elsewhere it is not renamed. */
const COS_PATHS = /^(packages\/shift-manager\/|packages\/workforce\/test\/|goals\/)/;

/** A goal's dated verdict row: what ran, under the names it had. */
const VERDICT_ROW = /^\| \d{4}-\d{2}-\d{2} \|/;

/** A look check's quote of design v2 (`has: "…"`): v2's own text, which still says `cos`. */
const V2_QUOTE = /has: "(?:[^"\\]|\\.)*"/g;

/** The id and the identifiers built on it. */
const ID_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/chief-of-staff/g, "shift-coordinator"],
  [/chiefOfStaff/g, "shiftCoordinator"],
  [/ChiefOfStaff/g, "ShiftCoordinator"],
  [/CHIEF_OF_STAFF/g, "SHIFT_COORDINATOR"],
  [/chief_of_staff/g, "shift_coordinator"],
];

/** Prose: the worker's name, as Shift Manager already shows it. */
const PROSE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b[Cc]hiefs [Oo]f [Ss]taff\b/g, "Shift Coordinators"],
  [/\b[Cc]hief [Oo]f [Ss]taff\b/g, "Shift Coordinator"],
  [/\bCoS\b/g, "Shift Coordinator"],
];

/**
 * Shift Manager's `cos` in a test id or a file name: `cos-panel`, `nav-cos`, `lab-no-cos`,
 * `sidebar-and-cos`. The only `cos` rules a path takes. `cos-changes-the-roster` is a
 * retired goal's name, kept as history.
 */
const PATH_COS_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?<![\w-])cos-(?!changes-the-roster)/g, "shift-coordinator-"],
  [/(?<=\w)-cos\b/g, "-shift-coordinator"],
];

/**
 * Shift Manager's `cos`, in each spelling. The rules run in this order, and the order is
 * the meaning: a hyphenated or quoted `cos` must be renamed before the identifier rule
 * sees it. Keep `shift-coordinator-cos` in the vocabulary sweep's rules.mjs matching these.
 */
const COS_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  ...PATH_COS_RULES,
  // The route, and a CSS selector's test id (`[data-testid=cos]`).
  [/\/cos\b/g, "/shift-coordinator"],
  [/(?<=data-testid=)cos\b/g, "shift-coordinator"],
  // The route level, the composer's scale, a test id prefix, a leg's name.
  [/(["'`])cos\1/g, "$1shift-coordinator$1"],
  // Identifiers: `cos`, `cos2`, `cosModel`, `openCos`, `SidebarAndCosRead`, `COS`, `COS_FLOW`, `OFF_COS`.
  [/(?<!Math\.)\bcos(?=[A-Z0-9_]|\b)/g, "shiftCoordinator"],
  [/(?<=[A-Za-z0-9])Cos(?=[A-Z_]|\b)/g, "ShiftCoordinator"],
  [/\bCos(?=[A-Z])/g, "ShiftCoordinator"],
  [/\bCOS(?=_|\b)/g, "SHIFT_COORDINATOR"],
  [/(?<=_)COS(?=_|\b)/g, "SHIFT_COORDINATOR"],
];

/** Goals that hold the id under a `chief` name. `chief` alone is also an ordinary test worker's name, so only these spellings move. */
const CHIEF_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bCHIEF\b/g, "SHIFT_COORDINATOR"],
  [/\btellChief\b/g, "tellShiftCoordinator"],
  [/\bchiefSession\b/g, "shiftCoordinatorSession"],
  [/\bscriptedChief\b/g, "scriptedShiftCoordinator"],
  [/\bscripted-chief\b/g, "scripted-shift-coordinator"],
  [/\bs-goal-chief-/g, "s-goal-shift-coordinator-"],
  [/`chief-\$\{/g, "`shift-coordinator-${"],
];

/** One goal's `chief()` opens a conversation with the Shift Coordinator. */
const CHIEF_OPENER = "goals/devforce-lab/it-answers-a-conversations-task/run.mts";

/**
 * "chief of staff" wrapped across a comment's lines, with the comment's
 * continuation at the break. The break stays, between the two new words.
 */
const WRAPPED_PROSE = [
  /\b[Cc]hief([ \t]*\n[ \t]*(?:\*|\/\/|#)?[ \t]*)[Oo]f [Ss]taff\b/g,
  /\b[Cc]hief [Oo]f([ \t]*\n[ \t]*(?:\*|\/\/|#)?[ \t]*)[Ss]taff\b/g,
];

function unwrapProse(text: string): string {
  return WRAPPED_PROSE.reduce((out, pattern) => out.replace(pattern, "Shift$1Coordinator"), text);
}

/** A JSON fixture's `"cos"` key is read as `.cos`, so it follows the identifier. */
const JSON_COS_KEY: readonly [RegExp, string] = [/"cos"(?=\s*:)/g, '"shiftCoordinator"'];

function apply(text: string, rules: ReadonlyArray<readonly [RegExp, string]>): string {
  return rules.reduce((out, [pattern, to]) => out.replace(pattern, to), text);
}

function renamePath(path: string): string {
  const renamed = apply(path, ID_RULES);
  return COS_PATHS.test(path) ? apply(renamed, PATH_COS_RULES) : renamed;
}

// Pass 1: paths, by `git mv`.
let moved = 0;
for (const path of git("ls-files", "--", ...TEXT_PATHS, ...TEXT_EXCLUDES).split("\n").filter(Boolean)) {
  const to = renamePath(path);
  if (to === path) continue;
  mkdirSync(dirname(resolve(repoRoot, to)), { recursive: true });
  git("mv", path, to);
  moved += 1;
}
console.log(`moved ${moved} files`);

// Pass 2: text, line by line so a verdict row keeps its names.
const files = git("grep", "-l", "-I", "-E", "chief|Chief|CHIEF|CoS|cos|Cos|COS", "--", ...TEXT_PATHS, ...TEXT_EXCLUDES)
  .split("\n")
  .filter(Boolean);
let changed = 0;
for (const file of files) {
  const path = resolve(repoRoot, file);
  const before = readFileSync(path, "utf8");
  const after = unwrapProse(before)
    .split("\n")
    .map((line) => {
      if (VERDICT_ROW.test(line)) return line;
      const quotes: string[] = [];
      let out = line.replace(V2_QUOTE, (quote) => `\u0000${quotes.push(quote) - 1}\u0000`);
      out = apply(apply(out, ID_RULES), PROSE_RULES);
      if (COS_PATHS.test(file)) {
        if (file.endsWith(".json")) out = out.replace(...JSON_COS_KEY);
        out = apply(out, COS_RULES);
      }
      if (file.startsWith("goals/")) out = apply(out, CHIEF_RULES);
      if (file === CHIEF_OPENER) out = out.replace(/\bchief\b/g, "shiftCoordinator");
      return out.replace(/\u0000(\d+)\u0000/g, (_all, i: string) => quotes[Number(i)]!);
    })
    .join("\n");
  if (after !== before) {
    writeFileSync(path, after);
    changed += 1;
  }
}
console.log(`text pass: ${changed} files`);
