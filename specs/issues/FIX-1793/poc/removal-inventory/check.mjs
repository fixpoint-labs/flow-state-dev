#!/usr/bin/env node
/**
 * FIX-1793 · re-derive what removing rooms and workstream claims touches.
 *
 * Experimental evidence for the spec's size and its surface list, not
 * production code. Run from the repository root:
 *
 *   node specs/issues/FIX-1793/poc/removal-inventory/check.mjs            # the inventory
 *   node specs/issues/FIX-1793/poc/removal-inventory/check.mjs --control  # the negative control
 *
 * It lists every tracked file (outside retained specs and internal docs) that
 * names a room, a talk session, the talk template, a workstream claim or the
 * workstream write, by identifier or in plain prose, and asserts TOTALITY: each
 * one is classified below, as removed whole, edited, left to another issue, or
 * an unrelated use of the word. An unclassified match fails the run.
 * `--control` plants an unclassified file that names a room only in prose,
 * runs the same scan, requires it to FAIL on that file, and removes the plant.
 *
 * It stays runnable after P3 deletes the files in REMOVE: their line counts are
 * the stored BASELINE, a deleted file is reported as deleted, and a classified
 * path that no longer matches is reported for re-checking, not fatal.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";

/** What names the surface this issue removes, by identifier. Applied to every tracked file. */
const SURFACE = [
  "room-lines", "room-seq", "room-answers", "room-deliveries",
  "ROOM_LINES", "ROOM_SEQ", "ROOM_ANSWERS", "ROOM_DELIVERIES", "ROOM_KIND",
  "workstream-claims", "WORKSTREAM_CLAIMS", "workstreamClaim",
  "talkSession", "talkBind", "talkJoin", "talkPost", "talkAnswer", "TALK_BIND", "TalkTemplate", "talk-template", "projects/talk",
  "readRoom", "postToRoom", "joinRoom", "roomSessionId", "talkFor",
  "mintFor", "setWorkstreams",
];

/**
 * Plain prose naming the feature, matched case-insensitively. Docs, figures and
 * comments say "the project's room" or "a talk session" with no identifier, and
 * SURFACE alone let those PASS unseen. The word has unrelated uses too ("make
 * room for", a mailbox id like `ops.room`); those are listed in UNRELATED, so
 * every hit is still a decision.
 */
const PROSE = "\\brooms?\\b|talk sessions?";

/** Files removed whole. Their line counts are the spec's "lines out". */
const REMOVE = {
  "packages/workforce/src/projects/talk.ts": "a session's way into a room",
  "packages/workforce/src/projects/room-store.ts": "room lines and the counter",
  "packages/workforce/src/projects/room-answer.ts": "a worker's answer claim in a room",
  "packages/workforce/src/projects/talk-template.ts": "the room's workers, charter and mint",
  "packages/shift-manager/src/lib/talk.ts": "Shift Manager's room client",
  "packages/workforce/test/project-room-answer.test.ts": "tests of the above",
  "packages/workforce/test/project-talk-template.test.ts": "tests of the above",
  "packages/shift-manager/test/talk.test.ts": "tests of the above",
  "packages/shift-manager/test/room-history.test.tsx": "tests of the above",
  "apps/docs/docs/workforce/project-room-handles.svg": "room figure",
  "apps/docs/docs/workforce/project-room-membership.svg": "room figure",
  "apps/docs/docs/workforce/project-room-parts.svg": "room figure",
  "apps/docs/docs/workforce/project-room-sessions.svg": "room figure",
  "apps/docs/docs/workforce/mailbox-or-room.svg": "room figure",
  "apps/docs/docs/workforce/mailbox-room-flow.svg": "room figure",
};

/**
 * The whole-file removals' line counts before P3 deletes them, kept so the
 * report still gives the spec's "lines out" afterwards. Figures are not counted.
 */
const BASELINE = { codeLines: 1474, testLines: 1475 };

/** Files edited: the room or claim parts come out, the rest stays. */
const EDIT = {
  "packages/workforce/src/projects/collections.ts": "S2 S7 · room collections stop being declared; claims stay until FIX-1792 removes them",
  "packages/workforce/src/projects/index.ts": "S7 · room and talk exports",
  "packages/workforce/src/projects/project-writes.ts": "S2 S7 · createProject gains visibility; setWorkstreams and claims stay until FIX-1792 removes them",
  "packages/workforce/src/projects/cas-retry.ts": "S7 · its header names the room's writers; the retry stays for the row writes",
  "packages/workforce/src/projects/project-workspace.ts": "S6 · a run finds its project from its workstream",
  "packages/workforce/src/projects/membership-gate.ts": "S3 S7 · its header names the room; the gate stays for project writes and openWorkstream",
  "packages/workforce/src/projects/project-refusal.ts": "S7 · the talk reasons go",
  "packages/workforce/src/mailbox-post-capability.ts": "S7 · the answer token's talk-session note",
  "packages/workforce/src/mailbox/mailbox-flow.ts": "S7 · join, bind and the talk branches of post, read and answer go",
  "packages/workforce/src/mailbox/mailbox-binder.ts": "S7 · mintFor goes",
  "packages/workforce/src/inventory/open-inventory.ts": "S7 · the mintFor skip",
  "packages/workforce/src/manifest-sources.ts": "S7 · the mintFor note",
  "packages/workforce/src/index.ts": "S7 · package exports",
  "packages/workforce/README.md": "S11 · docs",
  "packages/workforce/test/projects.test.ts": "S2 S7 · tests",
  "packages/workforce/test/inventory-binder.test.ts": "S7 · mintFor tests",
  "packages/workforce/test/mailbox-boards.test.ts": "S7 · mintFor tests",
  "packages/workforce/test/project-workspace.test.ts": "S6 · tests",
  "packages/shift-manager/src/lib/reads.ts": "S8 · projects and workstreams read; the room session goes",
  "packages/shift-manager/src/lib/derive.ts": "S8 · talkFor goes",
  "packages/shift-manager/src/surfaces/Project.tsx": "S8 · the Stream tab becomes the project coordinator",
  "packages/shift-manager/teams/devteam/host.mts": "S9 · the lab's projects and the chief of staff's tools",
  "packages/shift-manager/teams/devteam/workforce/org/resources/projects.ts": "S9 · declares `talk:`; the declaration and the template go",
  "packages/shift-manager/teams/devteam/workforce/flows/workers/em.mts": "S9 · the EM's room-answer action and its delivery shape go",
  "packages/shift-manager/teams/devteam/notify.mts": "S9 · the room door and the `room` decision flag go",
  "packages/shift-manager/teams/devteam/workforce/org/workers/chief-of-staff/WORKER.md": "S9 · openWorkstream joins its tools",
  "packages/shift-manager/teams/devteam/README.md": "S9 · the projects file's line",
  "packages/shift-manager/README.md": "S11 · the project-room sections",
  "packages/shift-manager/test/projects.test.tsx": "S8 · tests",
  "packages/shift-manager/test/reads.test.ts": "S8 · tests",
  "packages/shift-manager/test/static.test.ts": "S8 · tests",
  "packages/shift-manager/test/shell.test.tsx": "S8 · tests",
  "packages/shift-manager/test/fixtures/ask-lab/lab.mts": "S8 · a fixture's talk-session note",
  "apps/docs/docs/workforce/projects.md": "S11 · docs",
  "apps/docs/docs/workforce/chief-of-staff.md": "S11 · docs",
  "apps/docs/docs/workforce/inventory.md": "S11 · docs",
  "apps/docs/docs/workforce/overview.md": "S11 · the room in the projects paragraph and the page list",
  "apps/docs/docs/workforce/project-overview.svg": "S11 · redrawn as the epic's private-and-shared figure",
  "apps/docs/docs/shift-manager/overview.md": "S11 · the screens table",
  "apps/docs/docs/glossary.md": "S11 · the Room term and the figures' descriptions",
  "apps/docs/docs/glossary/layers.svg": "S11 · \"projects and rooms\"",
  "apps/docs/docs/glossary/shift-manager.svg": "S11 · the PROJECT + ROOM cell",
  "apps/docs/docs/glossary/workforce.svg": "S11 · the Room term",
  ".changeset/workforce-projects-and-rooms.md": "S11 · unreleased note announcing rooms, rewritten",
  ".changeset/workforce-project-talk-template.md": "S11 · unreleased note announcing rooms, removed",
  "goals/shift-manager/it-groups-workstreams-under-their-projects/goal.md": "S10 · rewritten",
  "goals/shift-manager/it-groups-workstreams-under-their-projects/run.mts": "S10 · rewritten",
  "goals/shift-manager/it-groups-workstreams-under-their-projects/controls/no-tool.mts": "S10 · rewritten",
  "goals/shift-manager/it-groups-workstreams-under-their-projects/controls/in-memory.ts": "S10 · rewritten",
  "goals/shift-manager/it-groups-workstreams-under-their-projects/controls/no-gate.ts": "S10 · rewritten",
  "goals/shift-manager/it-groups-workstreams-under-their-projects/controls/no-retry.ts": "S10 · rewritten",
  "goals/shift-manager/it-groups-workstreams-under-their-projects/fixtures/input.json": "S10 · rewritten",
  "goals/shift-manager/one-person-runs-a-labs-projects-and-people/goal.md": "S10 · its room legs retired",
  "goals/shift-manager/one-person-runs-a-labs-projects-and-people/j4.mts": "S10 · its room legs retired",
  "goals/shift-manager/one-person-runs-a-labs-projects-and-people/legs/a.mts": "S10 · its room legs retired",
  "goals/shift-manager/one-person-runs-a-labs-projects-and-people/seams.mts": "S10 · its room legs retired",
  "goals/shift-manager/one-person-runs-a-labs-projects-and-people/steps.mts": "S10 · its room legs retired",
  "goals/shift-manager/it-opens-a-lab/run.mts": "S10 · the No project's \"no room\" note",
  "goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/goal.md": "S10 · the Stream tab's line",
  "goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/parts.mts": "S10 · the Stream tab's part",
  "goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/legs.mts": "S10 · the Stream tab's room check",
  "goals/devforce-lab/it-codes-in-the-projects-repository/run.mts": "S6 S10 · keeps its claim path until FIX-1792",
};

/** Matches another issue removes, named so the sweep knows. */
const ELSEWHERE = {
  "apps/docs/docs/workforce/mailboxes.md": "FIX-1792 removes the page",
};

/** The word used for something else. Listed so a new hit is still a decision, not a pass. */
const UNRELATED = {
  ".agents/skills/cross-spec-review/SKILL.md": "\"outside the room\"",
  ".agents/skills/issue-lifecycle/SKILL.md": "\"make room for\"",
  ".agents/skills/second-look/SKILL.md": "\"make room for\"",
  ".agents/subagents/issue-worker.md": "\"outside the room\"",
  ".agents/workflows/epic-wake.js": "\"ran out of room\"",
  ".agents/workflows/verify.mjs": "\"ran out of room\", \"make room\"",
  "apps/docs/docs/fundamentals/flows.md": "\"make room for\"",
  "apps/kitchen-sink/test/mailbox-wake.test.ts": "a mailbox id, `room.one`",
  "docs/architecture/resource-collections.md": "\"make room\"",
  "docs/architecture/server-and-client.md": "\"make room for\"",
  "docs/atlas/conductor.html": "\"reserves room for\"",
  "docs/atlas/workforce.html": "a dated design atlas; its room entries are history",
  "docs/contributing/asking-for-decisions.md": "\"outside the room\"",
  "docs/contributing/orchestration.md": "\"make room for\"",
  "goals/context-supply/inherits-parent-conversation/goal.md": "\"in the room\"",
  "goals/devforce-lab/it-wakes-the-seat-a-file-declared/run.mts": "\"ran out of room\"",
  "goals/devtool-workforce-visibility/the-checklist-rows/row5.mts": "a mailbox id",
  "goals/org-seats/cos-changes-the-roster/goal.md": "a mailbox id, `ops.room`",
  "goals/org-seats/cos-changes-the-roster/seat-asks.mts": "a mailbox id, `ops.room`",
  "goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/run.mts": "a local variable",
  "goals/workforce-conventions/a-mailbox-holds-the-work-a-seat-drains/run.mts": "a list of words a mailbox name avoids",
  "packages/engine/src/context/resource-registry.ts": "\"make room for\"",
  "packages/engine/src/execution/retention.ts": "\"makes room for\"",
  "packages/engine/src/flowstate/createFlowState.ts": "\"leaves room for\"",
  "packages/engine/src/stores/testing/request-store-conformance.ts": "\"room to wake up\"",
  "packages/engine/test/retention.test.ts": "\"make room for\"",
  "packages/engine/test/stream-routes-external-dispatch.test.ts": "\"given room\"",
  "packages/harness-manager/src/workspace.ts": "\"leaves room for\"",
  "packages/harness-manager/test/workspace.spec.ts": "\"room to spare\"",
  "packages/integration-tests/src/scenarios/task-board-hand-off-handoff.test.ts": "\"make room for\"",
  "packages/orchestration/test/collection/task-caps.test.ts": "\"have room\"",
  "packages/orchestration/test/skills/skill-activator-evaluator.test.ts": "\"room-temperature\"",
  "packages/shift-manager/src/lib/send.ts": "\"room for the reads\"",
  "packages/shift-manager/test/fixtures/ask-lab/workforce/teams/ops/mailboxes/side/MAILBOX.md": "a mailbox described as a room",
  "packages/workforce/test/cross-org-collection-read.test.ts": "mailbox ids",
  "packages/workforce/test/symlink-containment-matrix.test.ts": "a mailbox file name",
  "packages/workforce/test/wake-member-seats.test.ts": "mailbox ids",
};

const CLASSIFIED = { ...REMOVE, ...EDIT, ...ELSEWHERE, ...UNRELATED };

/** Tracked files matching `pattern`. `git grep` exits 1 when nothing matches. */
function grep(flags, pattern) {
  try {
    const out = execFileSync(
      "git",
      ["grep", "-l", ...flags, pattern, "--", ".", ":!specs", ":!docs/internal"],
      { encoding: "utf8" }
    );
    return out.split("\n").filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

function scan() {
  const hits = new Set([...grep(["-E"], SURFACE.join("|")), ...grep(["-i", "-E"], PROSE)]);
  return [...hits].sort();
}

function lines(path) {
  return readFileSync(path, "utf8").split("\n").length - 1;
}

function report() {
  const matches = scan();
  const unclassified = matches.filter((path) => !(path in CLASSIFIED));
  const deleted = Object.keys(REMOVE).filter((path) => !existsSync(path));
  const stale = Object.keys(CLASSIFIED).filter((path) => !matches.includes(path) && !deleted.includes(path));
  const present = Object.keys(REMOVE).filter((p) => !p.endsWith(".svg") && existsSync(p));
  const sum = (paths) => paths.reduce((n, p) => n + lines(p), 0);
  return {
    matches,
    unclassified,
    stale,
    deleted,
    codeLines: sum(present.filter((p) => !p.includes("/test/"))),
    testLines: sum(present.filter((p) => p.includes("/test/"))),
  };
}

function print(r) {
  const figures = Object.keys(REMOVE).filter((p) => p.endsWith(".svg")).length;
  console.log(`matching tracked files: ${r.matches.length}`);
  console.log(`  removed whole: ${Object.keys(REMOVE).length} (baseline ${BASELINE.codeLines} source lines, ${BASELINE.testLines} test lines, ${figures} figures)`);
  console.log(`    deleted so far: ${r.deleted.length}; still present: ${r.codeLines} source lines, ${r.testLines} test lines`);
  console.log(`  edited:        ${Object.keys(EDIT).length}`);
  console.log(`  elsewhere:     ${Object.keys(ELSEWHERE).length}`);
  console.log(`  unrelated:     ${Object.keys(UNRELATED).length}`);
  if (r.stale.length > 0) console.log(`classified but no longer matching (re-check): ${r.stale.join(", ")}`);
  if (r.unclassified.length > 0) {
    console.log(`UNCLASSIFIED: ${r.unclassified.join(", ")}`);
    return false;
  }
  console.log("PASS · every match is classified");
  return true;
}

const PLANT = "packages/workforce/src/projects/zz-planted-room.ts";

if (process.argv.includes("--control")) {
  // Prose only, no identifier: the case SURFACE alone let through.
  writeFileSync(PLANT, "// Each member posts into the project's room through a talk session.\nexport {};\n");
  try {
    execFileSync("git", ["add", "--intent-to-add", PLANT]);
    const r = report();
    const failedOnPlant = r.unclassified.includes(PLANT);
    console.log(failedOnPlant ? "CONTROL PASS · the planted file was refused" : "CONTROL FAIL · the planted file slipped through");
    process.exitCode = failedOnPlant ? 0 : 1;
  } finally {
    execFileSync("git", ["rm", "--cached", "--quiet", "-f", PLANT]);
    rmSync(PLANT, { force: true });
  }
} else {
  process.exitCode = print(report()) ? 0 : 1;
}
