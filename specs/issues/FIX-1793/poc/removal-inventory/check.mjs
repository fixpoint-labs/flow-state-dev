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
 * workstream write, and asserts TOTALITY: each one is classified below, as
 * removed whole, edited, or left to another issue. An unclassified match fails
 * the run. `--control` plants an unclassified file that names a room, runs the
 * same scan, requires it to FAIL on that file, and removes the plant.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";

/** What names the surface this issue removes. One alternation, applied to every tracked file. */
const SURFACE = [
  "room-lines", "room-seq", "room-answers", "room-deliveries",
  "ROOM_LINES", "ROOM_SEQ", "ROOM_ANSWERS", "ROOM_DELIVERIES", "ROOM_KIND",
  "workstream-claims", "WORKSTREAM_CLAIMS", "workstreamClaim",
  "talkSession", "talkBind", "talkJoin", "talkPost", "talkAnswer", "TALK_BIND", "TalkTemplate", "talk-template", "projects/talk",
  "readRoom", "postToRoom", "joinRoom", "roomSessionId", "talkFor",
  "mintFor", "setWorkstreams",
];

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
  "apps/docs/docs/workforce/mailbox-or-room.svg": "room figure",
  "apps/docs/docs/workforce/mailbox-room-flow.svg": "room figure",
};

/** Files edited: the room or claim parts come out, the rest stays. */
const EDIT = {
  "packages/workforce/src/projects/collections.ts": "S2 S7 · room collections stop being declared, rows kept; claims marked deprecated",
  "packages/workforce/src/projects/index.ts": "S7 · room and talk exports",
  "packages/workforce/src/projects/project-writes.ts": "S2 S7 · createProject gains visibility; setWorkstreams and claims marked deprecated",
  "packages/workforce/src/projects/cas-retry.ts": "S7 · its header names the room's writers; the retry stays for the row writes",
  "packages/workforce/src/projects/project-workspace.ts": "S6 · a run finds its project from its workstream",
  "packages/workforce/src/mailbox/mailbox-flow.ts": "S7 · join, bind and the talk branches of post, read and answer",
  "packages/workforce/src/mailbox/mailbox-binder.ts": "S7 · mintFor refused by name",
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
  "packages/shift-manager/teams/devteam/workforce/org/workers/chief-of-staff/WORKER.md": "S9 · openWorkstream joins its tools",
  "packages/shift-manager/test/projects.test.tsx": "S8 · tests",
  "packages/shift-manager/test/reads.test.ts": "S8 · tests",
  "packages/shift-manager/test/static.test.ts": "S8 · tests",
  "apps/docs/docs/workforce/projects.md": "S11 · docs",
  "apps/docs/docs/workforce/chief-of-staff.md": "S11 · docs",
  "apps/docs/docs/workforce/inventory.md": "S11 · docs",
  ".changeset/workforce-projects-and-rooms.md": "S11 · unreleased note announcing rooms, rewritten",
  ".changeset/workforce-project-talk-template.md": "S11 · unreleased note announcing rooms, removed",
  "goals/shift-manager/it-groups-workstreams-under-their-projects/goal.md": "S10 · rewritten",
  "goals/shift-manager/it-groups-workstreams-under-their-projects/run.mts": "S10 · rewritten",
  "goals/shift-manager/it-groups-workstreams-under-their-projects/controls/no-tool.mts": "S10 · rewritten",
  "goals/shift-manager/one-person-runs-a-labs-projects-and-people/j4.mts": "S10 · its room legs retired",
  "goals/shift-manager/one-person-runs-a-labs-projects-and-people/legs/a.mts": "S10 · its room legs retired",
  "goals/shift-manager/one-person-runs-a-labs-projects-and-people/seams.mts": "S10 · its room legs retired",
  "goals/shift-manager/one-person-runs-a-labs-projects-and-people/steps.mts": "S10 · its room legs retired",
  "goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/goal.md": "S10 · the Stream tab's line",
  "goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/parts.mts": "S10 · the Stream tab's part",
  "goals/devforce-lab/it-codes-in-the-projects-repository/run.mts": "S6 S10 · keeps its claim path until FIX-1792",
};

/** Matches another issue removes, named so the sweep knows. */
const ELSEWHERE = {
  "apps/docs/docs/workforce/mailboxes.md": "FIX-1792 removes the page",
};

const CLASSIFIED = { ...REMOVE, ...EDIT, ...ELSEWHERE };

function scan() {
  const out = execFileSync(
    "git",
    ["grep", "-l", "-E", SURFACE.join("|"), "--", ".", ":!specs", ":!docs/internal"],
    { encoding: "utf8" }
  );
  return out.split("\n").filter(Boolean).sort();
}

function lines(path) {
  return readFileSync(path, "utf8").split("\n").length - 1;
}

function report() {
  const matches = scan();
  const unclassified = matches.filter((path) => !(path in CLASSIFIED));
  const stale = Object.keys(CLASSIFIED).filter((path) => !matches.includes(path));
  const removeLines = Object.keys(REMOVE).filter((p) => !p.endsWith(".svg"));
  const code = removeLines.filter((p) => !p.includes("/test/"));
  const tests = removeLines.filter((p) => p.includes("/test/"));
  const sum = (paths) => paths.reduce((n, p) => n + lines(p), 0);
  return { matches, unclassified, stale, codeLines: sum(code), testLines: sum(tests) };
}

function print(r) {
  console.log(`matching tracked files: ${r.matches.length}`);
  console.log(`  removed whole: ${Object.keys(REMOVE).length} (${r.codeLines} source lines, ${r.testLines} test lines, 5 figures)`);
  console.log(`  edited:        ${Object.keys(EDIT).length}`);
  console.log(`  elsewhere:     ${Object.keys(ELSEWHERE).length}`);
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
  writeFileSync(PLANT, 'export const PLANTED = "room-lines";\n');
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
