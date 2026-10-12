#!/usr/bin/env node
/**
 * FIX-1872 · re-derive the spec's counted facts from the tree, so review
 * argues about the design and not about the numbers.
 *
 * Retained evidence, not production code: nothing imports it, it is outside
 * every package and every default build, test, lint and knip discovery.
 *
 * What it asserts:
 *
 *   F1  Only the coordinator dispatches onto the post entry: exactly two
 *       dispatchers, both in coordinator-flow.ts, both routes of the one
 *       delivery router, which only the one delivery sequencer runs.
 *   F2  Every route into that sequencer is a post that expects an answer:
 *       the judgment hand-off tool and the fixed policies' picks. Nothing
 *       else runs it.
 *   F3  The post entry hands back exactly two things, both to the
 *       delivering conversation: an answer, or a report of none. So no post
 *       a coordinator sends today is a tell (epic D2's sort).
 *   F4  Totality: every tracked file outside specs/, internal docs and
 *       changelogs that names a retired surface is classified below. An
 *       unclassified file fails the check.
 *
 * Run from the repository root:
 *
 *   node specs/issues/FIX-1872/poc/inventory/check.mjs
 *   PLANT=1 node specs/issues/FIX-1872/poc/inventory/check.mjs   # negative control: must exit 1
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const failures = [];
const fail = (message) => failures.push(message);
const read = (path) => readFileSync(path, "utf8");
const count = (text, pattern) => (text.match(pattern) ?? []).length;

const gitGrep = (args) => {
  try {
    return execFileSync("git", ["grep", ...args, "--", ".", ":!specs", ":!docs/internal", ":!**/CHANGELOG.md", ":!.changeset"], {
      encoding: "utf8"
    })
      .split("\n")
      .filter(Boolean);
  } catch (error) {
    if (error.status === 1) return []; // no match
    throw error;
  }
};

// --- F1 ------------------------------------------------------------------
const FLOW = "packages/workforce/src/coordinator/coordinator-flow.ts";
const flow = read(FLOW);
const postDispatchSites = gitGrep(["-nE", "action: (DELEGATED_POST_ENTRY|\"onDelegatedPost\")"]).filter(
  (line) => !line.includes("/test/")
);
if (postDispatchSites.length !== 2 || !postDispatchSites.every((line) => line.startsWith(`${FLOW}:`))) {
  fail(`F1: wanted two post-entry dispatchers, both in ${FLOW}; found ${JSON.stringify(postDispatchSites)}`);
}
// The router is defined once and used once, inside the delivery sequencer.
if (count(flow, /\bdispatchDelivery\b/g) !== 2 || !/\.stepIf\([^\n]*dispatchDelivery\.rescue/.test(flow)) {
  fail("F1: the delivery router should be defined once and run only by the delivery sequencer");
}

// --- F2 ------------------------------------------------------------------
const deliverOneUses = flow
  .split("\n")
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => /\bdeliverOne\b/.test(line) && !/const deliverOne\b/.test(line));
const users = deliverOneUses.map(({ line }) =>
  /handOffTool|stepIf\(\(value: unknown\) => deliveryRequestSchema/.test(line)
    ? "judgment hand-off"
    : /forEach\(\(placed: Placed\)/.test(line)
      ? "fixed policies' picks"
      : `unclassified: ${line.trim()}`
);
if (users.length !== 2 || users.some((user) => user.startsWith("unclassified"))) {
  fail(`F2: wanted exactly the judgment hand-off and the fixed policies' picks; found ${JSON.stringify(users)}`);
}

// --- F3 ------------------------------------------------------------------
const post = read("packages/workforce/src/coordinator/delegated-post.ts");
const actions = [...post.matchAll(/action: ([A-Z_]+)/g)].map((m) => m[1]).sort();
if (JSON.stringify(actions) !== JSON.stringify(["DELEGATE_ANSWER_ACTION", "DELEGATE_MISSED_ACTION"])) {
  fail(`F3: the post entry should send only an answer or a report of none; it sends ${JSON.stringify(actions)}`);
}
if (count(post, /session: \{ from: true \}/g) !== 2) {
  fail("F3: both sends should go back to the delivering conversation (`session: { from: true }`)");
}

// --- F4 ------------------------------------------------------------------
// retire: removed with the ledger · rewrite: source, test or doc that changes ·
// fence-read: a goal that reads the ledger and reads rows instead ·
// name-only: wording that names the tool · other: another meaning of the word ·
// history: a dated verdict-log row, never rewritten.
const CLASSIFIED = {
  "packages/workforce/src/delivery-ledger.ts": "retire",
  "packages/workforce/test/delivery-ledger.test.ts": "retire",
  "packages/workforce/src/coordinator/coordinator-flow.ts": "rewrite",
  "packages/workforce/src/coordinator/coordinator-keys.ts": "rewrite",
  "packages/workforce/src/coordinator/coordinator-rounds.ts": "rewrite",
  "packages/workforce/src/coordinator/coordinator-state.ts": "rewrite",
  "packages/workforce/src/coordinator/coordinator-route.ts": "rewrite",
  "packages/workforce/src/coordinator/coordinator-lines.ts": "rewrite",
  "packages/workforce/src/coordinator/delegated-post.ts": "rewrite",
  "packages/workforce/src/delegates/worker-delegates.ts": "rewrite",
  "packages/workforce/src/delegates/delegate-list.ts": "rewrite",
  "packages/workforce/src/projects/project-coordinator.ts": "rewrite",
  "packages/workforce/README.md": "rewrite",
  "packages/workforce/test/coordinator-rounds.test.ts": "rewrite",
  "packages/workforce/test/coordinator-routing.test.ts": "rewrite",
  "packages/workforce/test/coordinator-delegates.test.ts": "rewrite",
  "packages/workforce/test/coordinator-followup-context.test.ts": "rewrite",
  "packages/workforce/test/project-coordinator.test.ts": "rewrite",
  "packages/workforce/test/any-worker-files.test.ts": "rewrite",
  "packages/workforce/test/conversation-board-notices.test.ts": "rewrite",
  "packages/shift-manager/teams/devteam/workforce/org/workers/chief-of-staff/WORKER.md": "rewrite",
  "packages/shift-manager/teams/devteam/workforce/org/workers/project-coordinator/WORKER.md": "rewrite",
  "packages/shift-manager/test/devteam-chief-of-staff-coordinator.test.ts": "rewrite",
  "packages/shift-manager/test/devteam-em-workstream.test.ts": "rewrite",
  "packages/shift-manager/test/project-workstreams.test.tsx": "rewrite",
  "apps/docs/docs/workforce/coordinators.md": "rewrite",
  "apps/docs/docs/workforce/chief-of-staff.md": "rewrite",
  "goals/coordinators/hands-each-post-to-its-delegates/goal.md": "fence-read",
  "goals/coordinators/hands-each-post-to-its-delegates/leg-e.mts": "fence-read",
  "goals/coordinators/hands-each-post-to-its-delegates/devteam.mts": "fence-read",
  "goals/projects/a-shared-project-has-one-owner-per-workstream/goal.md": "fence-read",
  "goals/projects/a-shared-project-has-one-owner-per-workstream/legs.mts": "fence-read",
  "goals/workforce-privacy/two-users-share-a-project-and-nothing-else/legs.mts": "fence-read",
  "goals/workforce-privacy/two-users-share-a-project-and-nothing-else/store.mts": "fence-read",
  "goals/coordinators/files-tasks-down-the-owners-chain/goal.md": "history",
  "goals/shift-manager/it-groups-workstreams-under-their-projects/goal.md": "history",
  "goals/shift-manager/one-person-runs-a-labs-projects-and-people/goal.md": "history",
  "goals/workers/files-and-splits-down-the-chain/goal.md": "history",
  "packages/shift-manager/src/gaps.ts": "other",
  "packages/shift-manager/src/surfaces/TaskFrame.tsx": "other",
  "packages/shift-manager/test/task-screen.test.tsx": "other",
  "packages/engine/src/transports/concurrency/arbiter.ts": "other",
  "packages/engine/src/transports/host/createInboundTransportHost.ts": "other",
  "packages/engine/test/execution/entry-admission.test.ts": "other",
  "packages/engine/test/transports/concurrency/lease-backend.test.ts": "other",
  "packages/orchestration/test/task-board/hand-off-seam.test.ts": "other",
  "packages/orchestration/test/task-board/task-board-park-exit-report.test.ts": "other",
  "packages/core/test/flow-entries.test.ts": "other",
  "docs/architecture/inbound-transports.md": "other"
};

const found = new Set([
  ...gitGrep(["-lwE", "handOff|DELIVERIES_STATE|DeliveryLedger|delegateAnswer|delegateMissed|DELEGATE_ANSWER_ACTION|DELEGATE_MISSED_ACTION"]),
  ...gitGrep(["-liE", "delivery-ledger|delivery ledger"])
]);
if (process.env.PLANT === "1") found.add("packages/workforce/src/planted-unclassified.ts");

const unclassified = [...found].filter((path) => !(path in CLASSIFIED)).sort();
const stale = Object.keys(CLASSIFIED).filter((path) => !found.has(path)).sort();
if (unclassified.length > 0) fail(`F4: unclassified files name a retired surface: ${unclassified.join(", ")}`);
if (stale.length > 0) fail(`F4: classified files no longer name one (update the table): ${stale.join(", ")}`);

const tally = {};
for (const path of found) tally[CLASSIFIED[path] ?? "unclassified"] = (tally[CLASSIFIED[path] ?? "unclassified"] ?? 0) + 1;

console.log(`F1 post-entry dispatchers: ${postDispatchSites.length}`);
console.log(`F2 routes into the delivery sequencer: ${users.join(" · ")}`);
console.log(`F3 what the post entry sends back: ${actions.join(" · ")}`);
console.log(`F4 files naming a retired surface: ${found.size} · ${JSON.stringify(tally)}`);
if (failures.length > 0) {
  console.error(`FAIL\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS");
