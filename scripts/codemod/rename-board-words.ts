/**
 * Codemod: FIX-2246, the board words.
 *
 * A coordinator's post is a routed task, a wait is a wait in its stored marks
 * too, the board dispatches under its route names, a worker message's budget
 * is a budget, and Workforce's filing kit is a factory. The head names are
 * the contract in `specs/epics/FIX-2071/renames.md` → "Owned here", FIX-2246's
 * rows; `postId`'s head name, `messageRequestId`, is the amendment row this
 * issue adds there.
 *
 * One phase per slice, each its own commit (`--phase <name>`; all of them, in
 * order, with none), so a slice that stalls drops out of the PR without
 * holding the rest:
 *
 * - `routed-task`: the post names still live, `RoundPost` and `postId`. Each
 *   is unique, so a word-bounded replace is the same rename the checker would
 *   make, and it reaches what the checker can't: `.mts` goals, a row's sealed
 *   payload read through `any`, docs.
 * - `wait-marks`: a task notice's `asked` flag becomes `waitedOn` in the four
 *   files that carry the notice (`asked` is an ordinary word elsewhere), and a
 *   wait gate's id and resolver prefix `ask:` becomes `wait:`.
 * - `dispatch-routes`: the board's dispatch blocks `<board>-hand-off-<assignee>`
 *   and `<board>-hand-off-fallback` become `-dispatch-`; the store tests' wake
 *   entry `runTaskBoard` is `dispatch`, the entry's name.
 * - `message-budget`: `messages.hopLimit` becomes `messages.budget`, and
 *   `DEFAULT_MESSAGE_HOP_LIMIT` `DEFAULT_MESSAGE_BUDGET`.
 * - `factory`: the filing kit and the session kit (`defineSessionBoard`'s
 *   answer) become the factory, in prose and in a `kit` variable, in the files
 *   that name it. A worker package a test names `kit` and Shift Manager's
 *   workstream kit are other things, and are not listed.
 *
 * What the phases can't say (readers deleted with no second spelling, a
 * shape's marked lines, grammar after a rename) is a hand commit after them.
 *
 * Usage: `pnpm tsx scripts/codemod/rename-board-words.ts [--phase <name>]`.
 * Re-run on the branch's pre-rename base to regenerate a conflicting PR
 * (FIX-2071 ER-2).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

/** Where a phase reads: code, tests, goals, apps and published docs. Retained specs, internal design docs and changelogs are history. */
const TEXT_PATHS = ["packages", "apps/docs/docs", "apps/docs/guides", "apps/kitchen-sink", "goals", "docs/architecture"];
const TEXT_EXCLUDES = [":!**/CHANGELOG.md", ":!**/node_modules/**", ":!**/dist/**"];

/** A goal's dated verdict row: a record of a run, kept as it was written. */
const VERDICT_ROW = /^\| \d{4}-\d{2}-\d{2} \|/;

/** One replacement: what it matches, what it writes, and where it may write. */
interface Rule {
  readonly pattern: RegExp;
  readonly to: string | ((match: string) => string);
  /** Only these files (repo-relative). Without it, every file under TEXT_PATHS a `find` grep names. */
  readonly files?: readonly string[];
  /** The fixed string `git grep -l` narrows candidates by, when `files` is absent. */
  readonly find?: string;
  /** Path prefixes left alone. */
  readonly skip?: readonly string[];
}

function candidates(rule: Rule): string[] {
  if (rule.files !== undefined) return [...rule.files];
  let listed: string;
  try {
    listed = execFileSync("git", ["grep", "-lF", rule.find!, "--", ...TEXT_PATHS, ...TEXT_EXCLUDES], { cwd: repoRoot, encoding: "utf8" });
  } catch {
    return []; // git grep exits 1 when nothing matches: the name is already gone
  }
  return listed
    .split("\n")
    .filter((file) => file && !(rule.skip ?? []).some((prefix) => file.startsWith(prefix)));
}

/** Apply one rule line by line, leaving verdict rows alone. Returns the files it changed. */
function apply(rule: Rule): number {
  let changed = 0;
  for (const file of candidates(rule)) {
    const path = resolve(repoRoot, file);
    const before = readFileSync(path, "utf8");
    const after = before
      .split("\n")
      .map((line) => (VERDICT_ROW.test(line) ? line : line.replace(rule.pattern, rule.to as string)))
      .join("\n");
    if (after !== before) {
      writeFileSync(path, after);
      changed++;
    } else if (rule.files !== undefined) {
      throw new Error(`${file}: ${rule.pattern.source} matched nothing`);
    }
  }
  return changed;
}

const exact = (names: Record<string, string>): Rule[] =>
  Object.entries(names).map(([from, to]) => ({ pattern: new RegExp(`\\b${from}\\b`, "g"), to, find: from }));

const NOTICE_FILES = [
  "packages/orchestration/src/tasks/notice/task-notice.ts",
  "packages/orchestration/src/tasks/notice/task-settled-entry.ts",
  "packages/workforce/src/conversation-board/task-settled.ts",
  "packages/orchestration/test/tasks/task-notice.test.ts",
];

/** The files that name the filing or session kit. */
const FACTORY_FILES = [
  "apps/docs/docs/workforce/delegating-work.md",
  "apps/docs/docs/workforce/messaging-workers.md",
  "apps/docs/docs/workforce/workers-on-disk.md",
  "goals/workers/files-and-splits-down-the-chain/lab/fsdev.config.mts",
  "packages/shift-manager/teams/devteam/workforce/flows/workers/em.mts",
  "packages/shift-manager/test/fixtures/multi-worker-collab/README.md",
  "packages/shift-manager/test/fixtures/multi-worker-collab/figures/setup.svg",
  "packages/shift-manager/test/fixtures/multi-worker-collab/host.mts",
  "packages/shift-manager/test/fixtures/multi-worker-collab/workforce/flows/workers/planner.mts",
  "packages/shift-manager/test/fixtures/multi-worker-collab/workforce/flows/workers/worker.mts",
  "packages/workforce/README.md",
  "packages/workforce/src/conversation-board/board-entries.ts",
  "packages/workforce/src/conversation-board/chain.ts",
  "packages/workforce/src/conversation-board/routed-session.ts",
  "packages/workforce/src/conversation-board/session-board.ts",
  "packages/workforce/src/conversation-board/task-admission.ts",
  "packages/workforce/src/messages/delivery.ts",
  "packages/workforce/src/messages/index.ts",
  "packages/workforce/src/messages/message-limits.ts",
  "packages/workforce/src/messages/message-log.ts",
  "packages/workforce/src/messages/message-received-entry.ts",
  "packages/workforce/src/workers/chain-limit.ts",
  "packages/workforce/test/answer-again-finished-tasks.test.ts",
  "packages/workforce/test/split-harness.ts",
  "packages/workforce/test/worker-plans-its-steps.test.ts",
  "packages/workforce/test/worker-roles.test.ts",
];

const PHASES: Record<string, readonly Rule[]> = {
  // `onDelegatedPost`, `isPostRow`, `onPostSettled` and `postCancelled` are
  // gone from package source already; what names them is a test or goal
  // checking they stay gone, so they are marked by hand, never renamed.
  "routed-task": exact({ RoundPost: "RoundTask", postId: "messageRequestId" }),
  "wait-marks": [
    { pattern: /\basked\b/g, to: "waitedOn", files: NOTICE_FILES },
    // A gate id or resolver built or written with the prefix, in a template or string literal.
    { pattern: /(?<=["'`])ask:/g, to: "wait:", find: "ask:", skip: ["goals/"] },
  ],
  "dispatch-routes": [
    { pattern: /-hand-off-(?=fallback`|\$\{assignee\.name\}`)/g, to: "-dispatch-", files: ["packages/orchestration/src/task-board/index.ts"] },
    {
      pattern: /"runTaskBoard"/g,
      to: '"dispatch"',
      files: [
        "packages/engine/src/stores/testing/wake-store-conformance.ts",
        "packages/engine/test/durability-sweeper-wakes.test.ts",
        "packages/engine/test/request-wakes.test.ts",
        "packages/orchestration/test/tasks/pass.test.ts",
      ],
    },
  ],
  "message-budget": exact({ hopLimit: "budget", DEFAULT_MESSAGE_HOP_LIMIT: "DEFAULT_MESSAGE_BUDGET" }),
  factory: [
    { pattern: /\bkit\b/g, to: "factory", files: FACTORY_FILES },
    { pattern: /\bKit\b/g, to: "Factory", files: FACTORY_FILES.filter((file) => /\bKit\b/.test(readFileSync(resolve(repoRoot, file), "utf8"))) },
  ],
};

const asked = process.argv.indexOf("--phase");
const names = asked === -1 ? Object.keys(PHASES) : [process.argv[asked + 1]!];
for (const name of names) {
  const rules = PHASES[name];
  if (rules === undefined) throw new Error(`no phase "${name}"; phases: ${Object.keys(PHASES).join(", ")}`);
  const counts = rules.map(apply);
  console.log(`${name}: ${counts.join(" + ")} file writes`);
}
