// FIX-2409 spec evidence: every place Shift Manager starts a read of its snapshot, classified,
// and every action it runs, by the session the action writes a request on.
// Retained design evidence, not production code. Throwaway.
//
// Run from the repository root:
//   node specs/issues/FIX-2409/poc/refresh-sites/check.mjs
//   FIX2409_CONTROL=plant node specs/issues/FIX-2409/poc/refresh-sites/check.mjs   # must exit 1
//
// Totality: every non-test source file under packages/shift-manager/src is scanned.
// A refresh site is a call `refresh()` or a prop `={refresh}` (the snapshot's one read entry).
// An action site is a call `runAction(`. Each site is keyed `file#trimmed line`; every key
// found must be classified below, and every classified key must still be found.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = "packages/shift-manager/src";
const REFRESH = /\brefresh\(\)|=\{refresh\}/;
const ACTION = /\brunAction\(/;

/** Each snapshot read site, and what this spec does with it. */
const REFRESH_SITES = {
  "lib/lab-data.tsx#void refresh();": "keeps: boot, and own action (the run an answer resumed stopped)",
  "lib/lab-data.tsx#const timer = setTimeout(() => void refresh(), retryDelayMs(lapses - 1));": "keeps: lapsed retry (FIX-2373)",
  "lib/lab-data.tsx#await refresh();": "keeps: own action (an answer, an answerOne)",
  "components/Conversation.tsx#void refresh();": "keeps: own action (a line the user sent ended)",
  "surfaces/TaskFrame.tsx#void refresh();": "keeps: own action (a task action settled)",
  "surfaces/TaskFrame.tsx#if (sent.suspended) void refresh();": "keeps: own action (a line the user sent stopped on an ask)",
  "surfaces/Inbox.tsx#void refresh();": "keeps: own action (a reply delivered)",
  "App.tsx#<ConnectionScreen kind=\"unreachable\" title=\"Shift Manager couldn't reach the Lab\" failure={snapshot.unreachable} onRetry={refresh}>": "keeps: Retry",
  "surfaces/Project.tsx#<SectionFailure what=\"Projects\" failure={view.failure} onRetry={() => void refresh()} testId=\"project-failure\" />": "keeps: Retry",
  "surfaces/Project.tsx#<button type=\"button\" className=\"underline\" onClick={() => void refresh()}>": "keeps: Retry (read the Lab again)",
  "surfaces/Tasks.tsx#<SectionFailure what={`The boards of ${holder}`} failure={b.failure} onRetry={() => void refresh()} />": "keeps: Retry",
  "surfaces/Tasks.tsx#<SectionFailure what=\"The boards\" failure={snapshot.inventory.failure} onRetry={() => void refresh()} />": "keeps: Retry",
  "surfaces/ShiftCoordinator.tsx#const retry = () => void refresh();": "keeps: Retry",
  "surfaces/ShiftCoordinator.tsx#<SectionFailure what=\"The shift coordinator\" failure={snapshot.inventory.failure} onRetry={() => void refresh()} testId=\"shift-coordinator-worker-failure\" />": "keeps: Retry",
  "surfaces/Sidebar.tsx#const retry = () => void refresh();": "keeps: Retry",
  "surfaces/Inbox.tsx#<SectionFailure what=\"Inbox\" failure={snapshot.inbox.failure} onRetry={() => void refresh()} />": "keeps: Retry",
  "surfaces/Roster.tsx#<SectionFailure what=\"Roster\" failure={snapshot.inventory.failure} onRetry={() => void refresh()} testId=\"roster-inventory-failure\" />": "keeps: Retry",
  "surfaces/Roster.tsx#<SectionFailure what=\"The worker inventory\" failure={snapshot.inventory.failure} onRetry={() => void refresh()} testId=\"roster-inventory-failure\" />": "keeps: Retry",
  "surfaces/Roster.tsx#<SectionFailure what=\"Asks\" failure={snapshot.asks.failure} onRetry={() => void refresh()} testId=\"roster-asks-failure\" />": "keeps: Retry",
  "surfaces/Roster.tsx#<SectionFailure what={`${workstreamId}'s tasks`} failure={failure} onRetry={() => void refresh()} testId=\"roster-boards-failure\" />": "keeps: Retry",
  // A view that saw another session's change and nudges the snapshot. The subscription replaces them (ER-3).
  "components/TasksPanel.tsx#void refresh();": "goes: nudge (TasksPanel saw a task move)",
  "components/TaskBoardMeta.tsx#if (standing.current !== undefined && standing.current !== now) void refresh();": "goes: nudge (a board card saw a task move)",
  "lib/task.tsx#if (next === \"suspended\" && (before?.requestId !== openRun.requestId || before.status !== \"suspended\")) void refresh();": "goes: nudge (the task screen saw its run ask)",
};

/** Each action Shift Manager runs, by the session it writes a request on. */
const ACTION_SITES = {
  "lib/schedules.ts#runAction(client, ROSTER_FLOW, readerSessionId, LIST_SCHEDULES_ACTION, {})": "reader session · on every snapshot read (readAt) while Schedules is open",
  "lib/usage.ts#return (await runAction(client, flow, reader, action, input)).output;": "reader session · on every snapshot read (readAt) while Usage is open",
  "lib/usage.ts#return (await runAction(client, flow, own ?? newSessionId(USAGE_SESSION_PREFIX), action, input)).output;": "usage session (usage-own-*) · on every snapshot read while Usage is open",
  "lib/delegates.ts#return asList((await runAction(client, flow, sessionId, \"listDelegates\", {})).output);": "conversation session · once each time DelegatesPanel opens: one snapshot read, not a loop",
  "lib/delegates.ts#return asList((await runAction(client, flow, sessionId, \"addDelegate\", { worker })).output);": "conversation session · own action",
  "lib/delegates.ts#return asList((await runAction(client, flow, sessionId, \"removeDelegate\", { worker })).output);": "conversation session · own action",
  "lib/projects.ts#const { output } = await runAction(client, flow.id, readerSessionId(client.userId, flow.id), PROJECT_SETUP_ACTION, {});": "reader session · once per connection",
};

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) files.push(path);
  }
};
walk(join(ROOT, SRC));

const found = { refresh: new Map(), action: new Map() };
for (const path of files) {
  const file = relative(join(ROOT, SRC), path);
  readFileSync(path, "utf8").split("\n").forEach((line, i) => {
    const key = `${file}#${line.trim()}`;
    for (const [kind, re] of [["refresh", REFRESH], ["action", ACTION]]) {
      if (!re.test(line)) continue;
      if (kind === "refresh" && /^\s*refresh\(\): Promise/.test(line)) continue; // the type's declaration
      if (kind === "action" && /^\s*(export )?(async )?function runAction|^\s*\*|^\s*\/\//.test(line)) continue;
      const at = found[kind].get(key) ?? [];
      at.push(i + 1);
      found[kind].set(key, at);
    }
  });
}
if (process.env.FIX2409_CONTROL === "plant") found.refresh.set("surfaces/Planted.tsx#void refresh();", [1]);

let failed = false;
for (const [kind, table] of [["refresh", REFRESH_SITES], ["action", ACTION_SITES]]) {
  for (const [key, lines] of found[kind]) {
    if (!(key in table)) {
      console.log(`UNCLASSIFIED ${kind}: ${key} (line ${lines.join(", ")})`);
      failed = true;
    }
  }
  for (const key of Object.keys(table)) {
    if (!found[kind].has(key)) {
      console.log(`STALE ${kind}: ${key}`);
      failed = true;
    }
  }
}

const tally = (kind, table) => {
  const counts = {};
  for (const [key, lines] of found[kind]) {
    const cls = (table[key] ?? "unclassified").split(":")[0].split(" ·")[0];
    counts[cls] = (counts[cls] ?? 0) + lines.length;
  }
  return counts;
};
const sites = (kind) => [...found[kind].values()].reduce((n, lines) => n + lines.length, 0);
console.log(`${files.length} files scanned`);
console.log(`refresh sites: ${sites("refresh")}`, tally("refresh", REFRESH_SITES));
console.log(`action sites: ${sites("action")}`, tally("action", ACTION_SITES));
for (const [key, lines] of found.refresh) if ((REFRESH_SITES[key] ?? "").startsWith("goes")) console.log(`  goes · ${key.split("#")[0]}:${lines.join(",")}`);
if (failed) {
  console.log("FAIL");
  process.exit(1);
}
console.log("PASS");
