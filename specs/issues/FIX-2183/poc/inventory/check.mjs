#!/usr/bin/env node
/**
 * FIX-2183's factual base, re-derived: for each name the spec retires, the files it is in on
 * the commit checked out (package source / docs and READMEs / the rest), and a totality check
 * that every exported name in the modules the spec covers is either renamed or kept on purpose.
 *
 * Throwaway design evidence, not production code. Run from the repository root:
 *   node specs/issues/FIX-2183/poc/inventory/check.mjs            # counts + totality, exit 1 on a gap
 *   node specs/issues/FIX-2183/poc/inventory/check.mjs --control  # plants an unclassified export; must exit 1
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Retired head name → what it becomes. Identifiers only; prose is the sweep's prose rule. */
export const RENAMES = {
  // A task's questions (was: holds)
  TaskHold: "TaskQuestion", taskHoldSchema: "taskQuestionSchema",
  RowHold: "RowQuestion", rowHoldSchema: "rowQuestionSchema",
  SuspensionHold: "SuspensionQuestion", suspensionHoldSchema: "suspensionQuestionSchema",
  HoldAsk: "QuestionInit", HoldReleaser: "QuestionCloser", HoldAnswer: "QuestionAnswer",
  MAX_HOLD_PROMPT: "MAX_QUESTION_PROMPT",
  openHolds: "openQuestions", hasOpenHold: "hasOpenQuestion", openRowHolds: "openRowQuestions",
  isRowHold: "isRowQuestion", isSuspensionHold: "isSuspensionQuestion", suspensionHoldOf: "suspensionQuestionOf",
  holdsDue: "questionsDue", nextHoldDue: "nextQuestionDue", newRowHolds: "newRowQuestions",
  holdWrite: "questionWrite", HoldChange: "QuestionChange", HoldWriteResult: "QuestionWriteResult",
  payHoldDeadlines: "payQuestionDeadlines", holdDueMs: "questionDueMs",
  whileHoldOpen: "whileQuestionOpen", refuseWhenHeld: "refuseWithOpenQuestion",
  InboxHold: "InboxQuestion", RowHoldSource: "RowQuestionSource", SuspensionHoldSource: "SuspensionQuestionSource",
  answerHold: "answerOne", holdOfSuspension: "questionOfSuspension", openUserHolds: "openUserQuestions",
  // What keeps a running task open (was: waitingOn, filed work holds)
  waitingOn: "keptOpenBy", TaskWaitingOn: "TaskKeptOpenBy", setWaitingOn: "setKeptOpenBy",
  filedWorkHolds: "filedWorkKeepsOpen", holdsItsFiler: "keepsFilerOpen",
  // The claim, and a board's owner (was: holds the task, holder)
  heldTask: "claimedTask", heldTaskId: "claimedTaskId", heldRowOf: "claimedRowOf", ticketHoldsRow: "ticketClaimsRow",
  holderSessionId: "ownerSessionId", holderOf: "boardOwnerOf",
};

/** Hold-shaped exports kept on purpose, each with its reason. */
export const KEPT = {
  // The one meaning "hold" keeps: a filer's hold on a task that hasn't started.
  hold: "status held: TaskCollectionRef.hold, the filer's hold before a start",
  heldFromBlocked: "status held: a row stored blocked and read as held",
  // Not the task surface.
  canHoldWait: "core: whether a server can keep a wait; not a task state",
};

/** The modules whose exports the totality check reads. */
const MODULES = [
  "packages/orchestration/src/tasks/schema/hold.ts",
  "packages/orchestration/src/tasks/collection/holds.ts",
  "packages/orchestration/src/tasks/helpers/filed-work.ts",
  "packages/orchestration/src/tasks/index.ts",
  "packages/orchestration/src/inbox/index.ts",
  "packages/orchestration/src/inbox/types.ts",
  "packages/orchestration/src/inbox/holds.ts",
  "packages/orchestration/src/inbox/client.ts",
  "packages/orchestration/src/task-board/index.ts",
];

const git = (...args) => {
  try { return execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean); }
  catch { return []; }
};
const SRC = ["packages/*/src/**", ":!**/*.test.*", ":!**/CHANGELOG.md"];
const DOCS = ["apps/docs/docs/**", "apps/docs/guides/**", "packages/*/README.md", "docs/architecture/**"];
const REST = ["packages/*/test/**", "packages/**/*.test.*", "apps/kitchen-sink/**", "apps/devtool/**", "goals/**", "labs/**"];
const count = (name, paths) => git("grep", "-lw", "--", name, "--", ...paths).length;

let gaps = 0;
console.log(`commit ${git("rev-parse", "--short", "HEAD")[0]}`);
console.log("retired name | becomes | src / docs / rest");
for (const [name, becomes] of Object.entries(RENAMES)) {
  const c = [count(name, SRC), count(name, DOCS), count(name, REST)];
  if (c[0] + c[1] + c[2] === 0) { console.log(`GAP: ${name} is in no file (stale row)`); gaps++; }
  console.log(`${name} | ${becomes} | ${c.join(" / ")}`);
}

// Totality: every exported identifier in MODULES that names a hold or a wait-on is classified.
const SHAPED = /hold|held|waitingon/i;
const exported = new Set();
for (const file of MODULES) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const|type|interface|class)\s+(\w+)/g)) exported.add(m[1]);
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const id = part.replace(/\btype\b/, "").split(/\bas\b/).pop().trim();
      if (id) exported.add(id);
    }
  }
}
if (process.argv.includes("--control")) exported.add("plantedHoldThing");
for (const id of [...exported].sort()) {
  if (!SHAPED.test(id)) continue;
  if (id in RENAMES || id in KEPT) continue;
  console.log(`GAP: export ${id} names a hold and is neither renamed nor kept`);
  gaps++;
}
console.log(gaps === 0 ? "PASS: every hold-shaped export classified, every row live" : `FAIL: ${gaps} gap(s)`);
process.exit(gaps === 0 ? 0 : 1);
