// FIX-2626 POC, retained design evidence, not production code. Throwaway.
//
// What only a kit removes from claude-code-style's adapter, once views
// (FIX-2551, FIX-2623) and direct reads (FIX-2624) have landed. Every
// declaration in `labs/claude-code-style/src/adapter.ts` at the pinned commit
// is one row, credited to exactly one thing that removes it, or to "stays".
//
//   node specs/issues/FIX-2626/poc/client-half/attribute.mjs             # the table
//   node specs/issues/FIX-2626/poc/client-half/attribute.mjs --controls  # the red paths
//
// The check refuses to print a table unless every declaration it finds has a
// row and every row names a declaration it finds (totality, both ways), and
// unless every line of the file lands in exactly one row.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const COMMIT = "f0b34c529";
const FILE = "labs/claude-code-style/src/adapter.ts";

/**
 * What removes a declaration. The rule each one must meet is in README.md.
 * - views:   the live read and views (FIX-2551, FIX-2623): watch loops, re-reads
 *            on notices, and rows one package can compute on the server.
 * - direct:  direct reads and writes by scope (FIX-2624): the own-session helpers
 *            and what reads or writes through them.
 * - package: a package export, with no kit: a constant, a call or a view that one
 *            package can ship because it already depends on every input.
 * - kit:     only a kit's slot: data that joins two packages where neither depends
 *            on the other, so no single package can serve it.
 * - stays:   the app's own screen logic, its thin calls, the transcript (which keeps
 *            its session address under the epic), and the file header.
 */
const BY = ["views", "direct", "package", "kit", "stays"];

/** One row per declaration: name (with its scope) to what removes it. */
const ROWS = {
  // Top-level types and constants.
  "top:Unsubscribe": "views",
  "top:LabSession": "views", // a sessions view's row: ViewOutput (ER-6)
  "top:LabProject": "direct",
  "top:ThreadEntry": "stays",
  "top:ConnectionState": "stays",
  "top:ThreadView": "stays",
  "top:TaskStatus": "views",
  "top:LabTask": "views", // the board view's row: ViewOutput (ER-6)
  "top:TaskBoardCalls": "stays",
  "top:TaskWork": "stays",
  "top:WorkingNow": "stays",
  "top:LabHarness": "package", // harness-manager's readiness row
  "top:RepositoryCheck": "package",
  "top:LabAdapter": "views", // the watch contract; it goes with the watches
  "top:READINESS_FLOW": "package", // harness-manager can fix its own readiness address
  "top:READ_EVERY_MS": "views",
  "top:RECENT_TURNS": "views",
  "top:TURN_ACTIONS": "views",
  "top:ROW_CHANGES": "views",
  "top:TASKS_BOARD": "package",
  "top:UPDATE_TASK_ACTION": "package",
  "top:CODING_FLOW": "package",
  "top:RETRYABLE_SOURCES": "stays",
  "top:THREAD_ITEMS": "stays",
  "top:Item": "stays",
  "top:TASKS_EVERY_MS": "views",
  "top:BOARD_LEDGERS": "views",
  "top:isPlanWrite": "views",
  "top:retryAfterFailure": "views",
  "top:onNotice": "views",
  "top:reviewStopOf": "stays",
  "top:latestReviewStop": "stays",
  "top:reviewStopIdOf": "stays",
  "top:acceptOf": "stays",
  "top:landedOf": "stays",
  "top:textOf": "stays",
  "top:filesOf": "stays",
  "top:callOf": "stays",
  "top:filedTaskOfItem": "stays",
  "top:entriesOf": "stays",
  "top:withStopped": "stays",
  "top:createLabAdapter": "stays",
  "top:LabConnection": "stays",
  "top:fileReader": "stays",
  "top:followItems": "stays",
  "top:followRequestCalls": "stays",
  "top:STREAM_GONE": "stays",
  "top:inFlightOf": "stays",
  "top:createWiredLab": "stays",
  // Inside createWiredLab: its helpers.
  "lab:workforce": "stays",
  "lab:inbox": "stays",
  "lab:modes": "stays",
  "lab:flows": "package",
  "lab:flowOf": "package", // workforce's client can open a worker's session by worker id
  "lab:flowOfSession": "package",
  "lab:run": "package",
  "lab:keptUnlessFailed": "views",
  "lab:ownSessions": "direct",
  "lab:ownSession": "direct",
  "lab:projects": "direct",
  "lab:threadsSessions": "views",
  "lab:isThreads": "views",
  "lab:turnsRunningIn": "views",
  "lab:runningTurns": "views",
  "lab:stops": "stays",
  "lab:stopWatchers": "stays",
  "lab:wake": "stays",
  "lab:itemsOf": "views",
  "lab:firstLines": "views",
  "lab:firstLineOf": "views",
  "lab:LabSessionRead": "views",
  "lab:rowOf": "views",
  "lab:waitingCountFor": "views",
  "lab:Listed": "views",
  "lab:runSessionOf": "views",
  "lab:runningRunOf": "views",
  "lab:runLinkMoved": "views",
  "lab:threadFeeds": "stays",
  "lab:tasksOf": "views",
  "lab:runFlows": "views",
  "lab:holdsOf": "views",
  "lab:listedWithWaitingOn": "views",
  "lab:harnesses": "kit", // the fallback harness: workforce's worker setting x harness-manager's run
  "lab:harnessOf": "kit",
  "lab:outputs": "views",
  "lab:outputOf": "views",
  "lab:errors": "views",
  "lab:errorOf": "views",
  "lab:pullRequestReads": "package", // harness-manager over orchestration's holds
  "lab:pullRequestRecords": "package",
  "lab:waitOf": "package",
  "lab:pullRequestsOf": "package",
  "lab:boardAt": "package",
  "lab:boardOf": "kit", // fills each row's harness through the kit-only harnessOf(task)
  "lab:holdOn": "views",
  "lab:answerReview": "views",
  "lab:sessionOpened": "views",
  "lab:pinsDo": "direct",
  "lab:readPins": "direct",
  "lab:readDismissed": "direct",
  // The verbs createWiredLab returns.
  "verb:modes": "stays",
  "verb:watchSessions": "views",
  "verb:listProjects": "direct",
  "verb:createProject": "direct",
  "verb:checkRepository": "direct",
  "verb:readHarnesses": "direct",
  "verb:openSession": "package",
  "verb:send": "stays",
  "verb:upload": "stays",
  "verb:readFile": "stays",
  "verb:interrupt": "stays",
  "verb:retry": "stays",
  "verb:watchThread": "stays",
  "verb:watchTasks": "views",
  "verb:watchTaskWork": "stays",
  "verb:sayInThread": "stays",
  "verb:taskActions": "stays",
  "verb:resolve": "stays",
  "verb:requestChanges": "stays",
  "verb:watchPins": "direct",
  "verb:pin": "direct",
  "verb:unpin": "direct",
  "verb:watchDismissed": "direct",
  "verb:dismiss": "direct",
};

/** Every declaration in the file, with the line its doc comment starts on. */
export function declarations(lines) {
  const found = [];
  const wired = lines.findIndex((line) => /^export function createWiredLab\b/.test(line));
  const wiredEnd = wired < 0 ? -1 : lines.findIndex((line, i) => i > wired && line === "}");
  const ret = lines.findIndex((line, i) => i > wired && line === "  return {");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m = /^(?:export )?(?:declare )?(?:async )?(?:function|const|let|type|interface|class) (\w+)/.exec(line);
    if (m) {
      found.push({ key: `top:${m[1]}`, at: i });
      continue;
    }
    if (i > wired && i < wiredEnd) {
      m = /^  (?:const|let|type|function|async function) (\w+)/.exec(line);
      if (m) {
        found.push({ key: `lab:${m[1]}`, at: i });
        continue;
      }
      m = /^    (\w+):/.exec(line);
      if (m && i > ret && ret > 0) found.push({ key: `verb:${m[1]}`, at: i });
    }
  }
  // A declaration owns the comment block directly above it.
  for (const d of found) {
    let start = d.at;
    while (start > 0 && /^\s*(\/\*\*|\*|\*\/|\/\/)/.test(lines[start - 1])) start--;
    d.start = start;
  }
  return found;
}

/** Attribute every line to one row, or throw naming what is unaccounted for. */
export function attribute(text, rows = ROWS) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const found = declarations(lines);
  const keys = new Set(found.map((d) => d.key));
  const unclassified = found.filter((d) => !(d.key in rows)).map((d) => `${d.key} (line ${d.at + 1})`);
  const stale = Object.keys(rows).filter((key) => !keys.has(key));
  const duplicated = found.filter((d, i) => found.findIndex((e) => e.key === d.key) !== i).map((d) => d.key);
  const problems = [];
  if (unclassified.length) problems.push(`unclassified: ${unclassified.join(", ")}`);
  if (stale.length) problems.push(`rows naming nothing in the file: ${stale.join(", ")}`);
  if (duplicated.length) problems.push(`declared twice: ${duplicated.join(", ")}`);
  for (const [key, by] of Object.entries(rows)) if (!BY.includes(by)) problems.push(`${key}: "${by}" is not one of ${BY.join(", ")}`);
  if (problems.length) throw new Error(problems.join("\n"));

  const ordered = [...found].sort((a, b) => a.start - b.start);
  const totals = Object.fromEntries(BY.map((by) => [by, 0]));
  const items = Object.fromEntries(BY.map((by) => [by, []]));
  totals.stays += ordered[0].start; // the header: the doc comment and the imports
  for (let i = 0; i < ordered.length; i++) {
    const end = i + 1 < ordered.length ? ordered[i + 1].start : lines.length;
    const span = end - ordered[i].start;
    const by = rows[ordered[i].key];
    totals[by] += span;
    items[by].push(`${ordered[i].key.split(":")[1]} ${span}`);
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  if (sum !== lines.length) throw new Error(`lines attributed ${sum}, file has ${lines.length}`);
  return { lines: lines.length, declarations: found.length, totals, items };
}

function read() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "../../../../..");
  return execFileSync("git", ["show", `${COMMIT}:${FILE}`], { cwd: root, encoding: "utf8" });
}

function expectRed(name, run) {
  try {
    run();
  } catch (err) {
    console.log(`control ${name}: red as it must be — ${String(err.message).split("\n")[0]}`);
    return;
  }
  throw new Error(`control ${name}: passed, so the check proves nothing`);
}

const text = read();
if (process.argv.includes("--controls")) {
  // 1. A declaration nobody classified must stop the table.
  expectRed("planted-declaration", () =>
    attribute(text.replace("\n  const modes = MODES;\n", "\n  const modes = MODES;\n  const planted = 1;\n")),
  );
  // 2. A row naming nothing in the file must stop it too (the table can't go stale silently).
  expectRed("stale-row", () => attribute(text, { ...ROWS, "lab:noSuchHelper": "kit" }));
  // 3. The kit row is a reading that could have come out otherwise: reclassify one
  //    kit row as package and the kit total must move by exactly that row's lines.
  const base = attribute(text);
  const moved = attribute(text, { ...ROWS, "lab:boardOf": "package" });
  const boardOf = Number(base.items.kit.find((item) => item.startsWith("boardOf ")).split(" ")[1]);
  if (moved.totals.kit !== base.totals.kit - boardOf) throw new Error("control reclassify: the kit total did not move by boardOf's lines");
  console.log(`control reclassify: the kit total moves ${base.totals.kit} -> ${moved.totals.kit} (boardOf is ${boardOf} lines)`);
} else {
  const { lines, declarations: count, totals, items } = attribute(text);
  console.log(`${FILE} at ${COMMIT}: ${lines} lines, ${count} declarations, every one classified`);
  for (const by of BY) console.log(`  ${by.padEnd(8)} ${String(totals[by]).padStart(5)}  ${(100 * totals[by] / lines).toFixed(1)}%`);
  console.log(`  kit rows: ${items.kit.join(", ")}`);
}
