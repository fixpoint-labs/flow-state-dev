#!/usr/bin/env node
/**
 * FIX-1792 · re-derive the conversion's factual base.
 *
 * Retained spec evidence, not production code. Run from the repository root:
 *
 *   node specs/issues/FIX-1792/poc/inventory/check.mjs            # the census and the inventory
 *   node specs/issues/FIX-1792/poc/inventory/check.mjs --control  # the negative control
 *   node specs/issues/FIX-1792/poc/inventory/check.mjs --after    # the end state, once P4b lands
 *
 * Three parts, each with a TOTALITY assertion.
 *
 * 1. The census. Every tracked `MAILBOX.md` is parsed and must have a row in
 *    FILES, with its target. The counts the spec states (files, files with
 *    boards, boards, `boardActions:`, `mintFor:`, `flow:`, `routing:`) are
 *    re-derived and asserted, and each board file's boards must match its row.
 *
 * 2. The inventory. Every tracked file outside retained specs, internal docs
 *    and changesets that names the removed surface by identifier must be
 *    classified in FILE_CLASS. Every goal unit (`goals/<area>/<goal>`) that
 *    names the surface, or says "mailbox" at all, must have a disposition in
 *    GOALS: a goal stops running when the mailbox flow goes, whatever words it
 *    uses. A match nobody classified fails the run.
 *
 * 3. The removal inventory, by exported name. REMOVED_EXPORTS is every export
 *    the conversion removes. Census mode keeps it total: every export declared
 *    in a file FILE_CLASS marks R, and every mailbox- or claim-named export in
 *    package source, is in REMOVED_EXPORTS or in KEPT_EXPORTS with a reason.
 *
 * `--control` plants an unclassified source file, an unclassified goal that
 * names a mailbox only in prose, and an unlisted mailbox-named export, and
 * requires the census to FAIL on all three. It then requires `--after` to FAIL
 * on a plant naming exports the first `--after` missed, and on the two old
 * refusal fixtures still at their pre-move paths. It removes the plants.
 * `--after` asserts the end state: the only `MAILBOX.md` files are
 * AFTER_FIXTURES, under the pinned goal check, no file outside REFUSAL_HOMES
 * names a REMOVED_EXPORTS name, and MANIFEST_DOMAINS has no `mailboxes`.
 *
 * Out of scope on purpose: the word "mailbox" in package source and docs that
 * name no removed surface. That sweep is FIX-1796's.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const MODE = process.argv.includes("--control") ? "control" : process.argv.includes("--after") ? "after" : "census";

/** The removed surface, by identifier. Applied to every file the scan reads. */
const SURFACE = new RegExp(
  [
    "MAILBOX\\.md", "mailboxFlow", "defineMailboxFlow", "MAILBOX_KIND", "mailboxInstances", "openMailboxes",
    "readMailboxesDirectory", "MailboxManifest", "mailboxBoard", "mailboxTaskLists", "routeByPurpose",
    "wakeMemberSeats", "MAILBOX_ROUTE", "mailbox-route", "mailboxPostCapability", "POST_TO_MAILBOX",
    "post-to-mailbox", "postToMailbox", "mailboxKinds", "flows/mailboxes", "boardActions", "mintFor",
    "workstream-claims", "WORKSTREAM_CLAIMS", "[wW]orkstreamClaim", "setWorkstreams", "projectWritesMailboxInventory",
    "INVENTORY_REGISTER_MAILBOX", "INVENTORY_RETIRE_MAILBOXES", "inventoryMailbox", "MailboxPostLine", "MAILBOX_POST",
    "MAILBOX_SEAT_POST", "MailboxPostRefused", "mailboxSessionState", "/mailboxes/", "[\"'`]mailbox[\"'`]",
    "\\.mailboxes\\b", "\\bmailboxes:", "inventory/mailboxes", "inventory/members", "[\"'`]mailboxes[\"'`]",
  ].join("|"),
);

/**
 * The removal inventory: every exported name the conversion removes (S1, S2,
 * S9, S10). `--after` refuses each outside REFUSAL_HOMES, so the end-state gate
 * covers the whole removed surface, not a sample of it. Kept total by
 * `exportProblems()` in census mode.
 */
const REMOVED_EXPORTS = [
  // S9 · the mailbox flow (mailbox/mailbox-flow.ts)
  "mailboxFlow", "defineMailboxFlow", "DefineMailboxFlowOptions", "MailboxFlowFactory", "MAILBOX_KIND",
  "MAILBOX_ANSWER_ACTION", "MAILBOX_SEAT_POST_ACTION", "MailboxSessionState", "mailboxSessionStateSchema",
  "MailboxPostInput", "mailboxPostInputSchema", "mailboxAnswerInputSchema", "MailboxReadOutput", "mailboxReadOutputSchema",
  "MailboxRefusalReason", "MailboxPostRefusedError", "boundMailbox", "holdsBoards", "wakesSeats",
  "MailboxFileTaskInput", "mailboxFileTaskInputSchema", "MailboxFileTaskOutput", "mailboxFileTaskOutputSchema",
  "mailboxReadBoardInputSchema", "MailboxReadBoardOutput", "mailboxReadBoardOutputSchema", "mailboxBoardRowSchema",
  "MailboxFanOutInput", "MailboxNotifyInput", "mailboxNotifyInputSchema",
  "INVENTORY_REGISTER_MAILBOX", "INVENTORY_RETIRE_MAILBOXES", "inventoryMailboxRegisteredSchema", "inventoryMailboxesRetiredSchema",
  // S9 · the binder and boards (mailbox/mailbox-binder.ts, mailbox/mailbox-board.ts)
  "mailboxInstances", "MailboxInstancesOptions", "openMailboxes", "OpenMailboxesOptions", "MailboxKind", "mailboxBoardIds",
  "mailboxBoard", "mailboxBoardId", "mailboxBoardLedger", "mailboxBoardNameProblem", "mailboxBoardNamesFor",
  "mailboxBoardTaskTools", "resolveMailboxBoard", "MailboxBoardCollection", "MAILBOX_BOARDS_KEY", "MAILBOX_BOARD_CLIENT_FIELDS",
  "mailboxTaskLists",
  // S9 · post lines and the route record (mailbox/mailbox-items.ts, mailbox-post-line.ts, mailbox-route.ts)
  "emitMailboxPostLine", "readMailboxPostLines", "emitMailboxRouteRecord", "MAILBOX_POST_COMPONENT",
  "MailboxTranscriptLine", "mailboxTranscriptLineSchema", "MAILBOX_ROUTE_COMPONENT", "MAILBOX_ROUTE_EVALUATOR",
  "MailboxRoute", "MailboxRouting", "MailboxRouteRecord", "mailboxRouteRecordSchema",
  // S9 · best fit's mailbox wrapper, the wake, post-to-mailbox
  "routeByPurpose", "RouteByPurposeOptions", "wakeMemberSeats", "WakeMemberSeatsOptions", "hearingSeatsById", "reachableSeat",
  "mailboxPostCapability", "MAILBOX_POST_CAPABILITY", "POST_TO_MAILBOX_TOOL", "PostToMailboxInput", "postToMailboxInputSchema",
  // S9 · the inventory's mailbox and membership rows, devtool's and Shift Manager's readers of them
  "MailboxInventoryRow", "mailboxInventoryRowSchema", "defineMailboxInventoryCollection", "membershipKey",
  "MailboxRow", "MembershipRow", "toMailboxRow", "mailboxesBySeat", "mailboxOf",
  // S1 · the loader and the manifest
  "readMailboxesDirectory", "ReadMailboxesDirectoryResult", "MailboxManifest", "MailboxManifestError", "MailboxManifestErrorKind",
  // S2 · codegen
  "mailboxKinds",
  // S10 · claims, the project's list, setWorkstreams
  "WORKSTREAM_CLAIMS_RESOURCE", "WorkstreamClaim", "workstreamClaimSchema", "defineWorkstreamClaimsCollection",
  "SetWorkstreamsInput", "setWorkstreamsInputSchema", "setWorkstreamsOutputSchema", "projectWritesMailboxInventory",
];

/**
 * Exports a removed file declares, or mailbox-named exports, that the
 * conversion does not remove, each with why. A name here is not the surface.
 */
const KEPT_EXPORTS = {
  kindOf: "a generic helper name; goals and labs declare their own",
  orderedById: "moves with the seats inventory, which stays",
  isTalkTemplate: "FIX-1793 removes it with rooms",
  isTemplateMailbox: "FIX-1793 removes it with rooms",
  routeOf: "a generic name; internal to the removed flow",
  withoutRepeats: "a generic name; FIX-1791's lines may keep it",
  RECENT_LINES: "best fit's context; FIX-1791 S4 extracts the ladder",
  PostCase: "best fit's context; FIX-1791 S4 extracts the ladder",
  postCaseSchema: "best fit's context; FIX-1791 S4 extracts the ladder",
  routeRequestSchema: "best fit's request; FIX-1791 S4 extracts the ladder",
  RouteDecision: "best fit's decision; FIX-1791 S4 extracts the ladder",
  routeDecisionSchema: "best fit's decision; FIX-1791 S4 extracts the ladder",
  RouteLedger: "best fit's hold; FIX-1791 S4 extracts the ladder",
  RouteLedgerState: "best fit's hold; FIX-1791 S4 extracts the ladder",
  routeLedgerStateSchema: "best fit's hold; FIX-1791 S4 extracts the ladder",
  ROUTE_LEDGER_STATE: "best fit's hold; FIX-1791 S4 extracts the ladder",
  ROUTE_BLOCK: "best fit's evaluator; FIX-1791 S4 extracts the ladder",
  keepLine: "best fit's context; FIX-1791 S4 extracts the ladder",
  recordRoute: "a generic name; FIX-1791 records coordinator-route",
  ROUTED_TURN_STATE: "the agent's answer state; agent stays",
  routedTurnSchema: "the agent's answer state; agent stays",
  routedTurnStateSchema: "the agent's answer state; agent stays",
  answerRoutedPost: "the agent's answer path; FIX-1791 S9 replaces it",
  seatIdConfigSchema: "the agent's settings; agent stays",
  INVENTORY_REGISTER_SEATS: "the seats inventory stays",
  inventorySeatsRegisteredSchema: "the seats inventory stays",
  inventoryWriterActions: "the seats inventory stays",
};

/** Where discovery's pinned domain list lives; `--after` requires it without `mailboxes` (S9). */
const MANIFEST_DOMAINS_FILE = "packages/contracts/src/types/manifest.ts";

/** A name that marks an export as part of the removed surface, wherever it is declared. */
const SURFACE_NAME = /[Mm]ailbox|MAILBOX|[Ww]orkstreamClaim|WORKSTREAM_CLAIMS|[Ss]etWorkstreams/;

const REMOVED_NAME = new RegExp(`\\b(${REMOVED_EXPORTS.join("|")})\\b`);

/** Where the end state may still name an old shape: the refusals and their own tests and fixtures. */
const REFUSAL_HOMES = [
  "packages/workforce/src/mailbox/pre-rename.ts",
  "packages/workforce/src/loader/read-mailboxes-directory.ts",
  "packages/workforce/src/codegen/discover.ts",
  "packages/workforce/test/pre-rename.test.ts",
  "packages/workforce/test/read-mailboxes-directory.test.ts",
  "goals/coordinators/refuses-a-mailbox-file-by-name/",
  "apps/docs/docs/workforce/upgrading.md",
];

/**
 * The only `MAILBOX.md` files the end state keeps: the pre-rename goal's two
 * old files, moved unchanged under the pinned goal check (PLAN P4a). Exact
 * paths, so a fixture left at its old path, or a new one anywhere else, fails.
 */
const AFTER_FIXTURES = [
  "goals/coordinators/refuses-a-mailbox-file-by-name/fixtures/tree/teams/desk/mailboxes/front/MAILBOX.md",
  "goals/coordinators/refuses-a-mailbox-file-by-name/fixtures/tree/teams/desk/mailboxes/notices/MAILBOX.md",
];

const SKIP = (f) =>
  /^(specs\/|docs\/internal\/|\.changeset\/)/.test(f) || /CHANGELOG\.md$/.test(f) ||
  /\.(png|jpe?g|gif|ico|woff2?|db|sqlite|lock)$/.test(f) || f === "pnpm-lock.yaml";

// ── Part 1 · the census ─────────────────────────────────────────────────────

/**
 * Every MAILBOX.md, keyed by path, with its target and what the goal or app
 * uses it for. Targets: `session` (a coordinator; its board becomes the
 * conversation's own; every board file, D1),
 * `coordinator` (no board), `fixture` (kept as an old file for the refusal goal
 * check), `removed` (goes with the legs it served).
 */
const FILES = {
  "apps/kitchen-sink/workforce/teams/support/mailboxes/help/MAILBOX.md":
    { target: "session", boards: ["escalations"], use: "kitchen-sink's help desk: a specialist files a case that needs a person; nobody works it; the team panel lists it" },
  "goals/mailbox-boards/it-hands-a-task-to-a-fresh-hire/fixtures/workforce/teams/ops/mailboxes/desk/MAILBOX.md":
    { target: "session", boards: ["work"], use: "a coordinator hires a worker and files it a task by name" },
  "goals/mailbox-boards/it-runs-a-row-a-file-declared-board-holds/fixtures/workforce/teams/eng/mailboxes/feature/MAILBOX.md":
    { target: "session", boards: ["triage", "parked"], use: "one worker files a row and another's board runs it; parked is drained by nobody and goes" },
  "goals/mailbox-boards/it-runs-a-row-a-file-declared-board-holds/fixtures/workforce/teams/eng/mailboxes/notices/MAILBOX.md":
    { target: "removed", boards: [], use: "a mailbox on a kind of its own (digest), kept only for the retired a-mailbox-holds-the-work goal" },
  "goals/manager-queue-lab/lab/refusal-trees/board-in-a-seat-folder-corrected/teams/eng/mailboxes/queue/MAILBOX.md":
    { target: "session", boards: ["work"], use: "the corrected twin of a refusal tree: the board declared where it belongs loads" },
  "goals/manager-queue-lab/lab/refusal-trees/board-in-a-seat-folder/teams/eng/mailboxes/queue/MAILBOX.md":
    { target: "session", boards: ["work"], use: "a refusal tree: a worker folder that declares the board is refused" },
  "goals/manager-queue-lab/lab/workforce/teams/eng/mailboxes/queue/MAILBOX.md":
    { target: "session", boards: ["work"], use: "the manager files one row per desk; each desk's worker takes only its own" },
  "goals/pentest-lab/lab/refusal-trees/unknown-kind-corrected/teams/pentest/mailboxes/findings/MAILBOX.md":
    { target: "coordinator", boards: [], use: "a refusal tree's mailbox; the refusal is about a worker" },
  "goals/pentest-lab/lab/refusal-trees/unknown-kind/teams/pentest/mailboxes/findings/MAILBOX.md":
    { target: "coordinator", boards: [], use: "a refusal tree's mailbox; the refusal is about a worker" },
  "goals/pentest-lab/lab/refusal-trees/unknown-tool-corrected/teams/pentest/mailboxes/findings/MAILBOX.md":
    { target: "coordinator", boards: [], use: "a refusal tree's mailbox; the refusal is about a worker" },
  "goals/pentest-lab/lab/refusal-trees/unknown-tool/teams/pentest/mailboxes/findings/MAILBOX.md":
    { target: "coordinator", boards: [], use: "a refusal tree's mailbox; the refusal is about a worker" },
  "goals/pentest-lab/lab/scenario-trees/unknown-member/teams/pentest/mailboxes/briefing/MAILBOX.md":
    { target: "coordinator", boards: [], use: "names a member no file declares; it opened and skipped it, and is now refused at load" },
  "goals/pentest-lab/lab/workforce/teams/pentest/mailboxes/findings/MAILBOX.md":
    { target: "coordinator", boards: [], use: "one post wakes both declared workers" },
  "goals/shift-manager/it-briefs-and-talks-with-the-chief-of-staff/lab-no-cos/workforce/teams/desk/mailboxes/front/MAILBOX.md":
    { target: "session", boards: ["work"], use: "the landing summary counts what waits and runs, in a lab with no chief of staff" },
  "goals/shift-manager/it-briefs-and-talks-with-the-chief-of-staff/lab/workforce/teams/desk/mailboxes/front/MAILBOX.md":
    { target: "session", boards: ["work"], use: "the landing summary counts what waits on the person and what runs" },
  "goals/shift-manager/it-draws-v2s-look/lab/workforce/teams/desk/mailboxes/front/MAILBOX.md":
    { target: "session", boards: ["work"], use: "every screen draws the board's rows in v2's look" },
  "goals/shift-manager/it-sends-a-turn-into-a-seat-session/lab/asker/workforce/teams/desk/mailboxes/front/MAILBOX.md":
    { target: "coordinator", boards: [], use: "a person's line lands in a worker's session" },
  "goals/shift-manager/it-shows-who-is-on-shift/lab/workforce/teams/eng/mailboxes/desk/MAILBOX.md":
    { target: "session", boards: ["work"], use: "the roster shows the tasks each worker holds; the lead drains it" },
  "goals/shift-manager/it-shows-who-is-on-shift/lab/workforce/teams/ops/mailboxes/desk/MAILBOX.md":
    { target: "coordinator", boards: [], use: "a team that talks and keeps no board" },
  "goals/task-run-link/it-names-the-run-working-each-task/fixtures/workforce/teams/lab/mailboxes/desk/MAILBOX.md":
    { target: "session", boards: ["work"], use: "each handed-off row links the run working it" },
  "goals/workforce-mailboxes/a-fresh-host-wakes-its-member-agents/fixtures/workforce/teams/desk/mailboxes/front/MAILBOX.md":
    { target: "coordinator", boards: [], use: "a post wakes each agent member once, never on its own post" },
  "goals/workforce-mailboxes/a-pre-rename-lab-is-refused-by-name/fixtures/tree/teams/desk/mailboxes/front/MAILBOX.md":
    { target: "fixture", boards: [], use: "kept as an old file: this issue's goal check reads it and must refuse it" },
  "goals/workforce-mailboxes/a-pre-rename-lab-is-refused-by-name/fixtures/tree/teams/desk/mailboxes/notices/MAILBOX.md":
    { target: "fixture", boards: [], use: "kept as an old file naming a kind of its own; the goal check must refuse it" },
  "goals/workforce-mailboxes/a-routed-post-gets-one-answer/fixtures/workforce/teams/support/mailboxes/help/MAILBOX.md":
    { target: "coordinator", boards: [], use: "a routed post gets one specialist's answer" },
  "goals/workforce-mailboxes/a-routed-post-gets-one-answer/fixtures/workforce/teams/support/mailboxes/lounge/MAILBOX.md":
    { target: "coordinator", boards: [], use: "a mailbox without routing behaves as before" },
  "packages/shift-manager/teams/devteam/workforce/teams/eng/mailboxes/feature/MAILBOX.md":
    { target: "session", boards: ["work"], use: "the DevTeam builds a feature; the storefront project claims it, and its coding runs find the project through the claim. A workstream with FIX-1802" },
  "packages/shift-manager/teams/devteam/workforce/teams/eng/mailboxes/triage/MAILBOX.md":
    { target: "coordinator", boards: [], use: "where the team sorts reports; no default project lists it" },
  "packages/shift-manager/teams/devteam/workforce/teams/ops/mailboxes/oncall/MAILBOX.md":
    { target: "coordinator", boards: [], use: "the pager hand-off; no default project lists it" },
  "packages/shift-manager/teams/devteam/workforce/teams/ops/mailboxes/release/MAILBOX.md":
    { target: "coordinator", boards: [], use: "the storefront project lists it; it keeps no board. A workstream with FIX-1802" },
  "packages/shift-manager/test/fixtures/ask-lab/workforce/teams/ops/mailboxes/desk/MAILBOX.md":
    { target: "session", boards: ["work"], use: "Shift Manager's tests read its tasks, asks and inbox" },
  "packages/shift-manager/test/fixtures/ask-lab/workforce/teams/ops/mailboxes/side/MAILBOX.md":
    { target: "coordinator", boards: [], use: "a second place the asker sits" },
  "packages/shift-manager/test/fixtures/multi-seat-collab/workforce/teams/eng/mailboxes/queue/MAILBOX.md":
    { target: "session", boards: ["work"], use: "a planner files for a build and a review desk; a person answers a parked row" },
  "packages/shift-manager/test/fixtures/run-lab/workforce/teams/lab/mailboxes/desk/MAILBOX.md":
    { target: "session", boards: ["work"], use: "Shift Manager's run tests trace a row's run" },
};

/** The counts the spec states, re-derived from the files themselves. */
const EXPECT = { files: 33, withBoards: 15, boards: 16, boardActions: 3, mintFor: 0, flow: 2, routing: 2, emptyMembers: 2 };

/** Top-level frontmatter keys and the inline `boards: [a, b]` list. Enough for these files. */
function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return { keys: new Set(), boards: [], members: undefined };
  const keys = new Set();
  let boards = [];
  let members;
  for (const line of m[1].split("\n")) {
    const k = /^([A-Za-z_][\w-]*):(.*)$/.exec(line);
    if (!k) continue;
    keys.add(k[1]);
    const list = /^\s*\[(.*)\]\s*$/.exec(k[2]);
    const items = list ? list[1].split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    if (k[1] === "boards") boards = items ?? [];
    if (k[1] === "members") members = items;
  }
  return { keys, boards, members };
}

// ── Part 2 · the inventory ──────────────────────────────────────────────────

/**
 * Every non-goal file naming the removed surface. R removed whole · E edited ·
 * C converted (a host, fixture or test moves to a coordinator, a conversation
 * board or a workstream) · F carries a refusal · T FIX-1793 removes or rewrites
 * it first · W the word or a figure only, FIX-1796's sweep · U unrelated.
 * Each line is `path: "CLASS · surface · why"`; the surface IDs are PLAN.md's.
 */
const FILE_CLASS = {
  ".omp/extensions/mailbox.ts": "U · — · the agent-mailbox tool's command, not Workforce",
  "apps/docs/docs/client/react.md": "E · S12 · an example opens a session on flowKind \"mailbox\"",
  "apps/docs/docs/devtool/overview.md": "E · S12 · the inventory view's registered-mailboxes row",
  "apps/docs/docs/glossary.md": "W · — · the glossary is FIX-1796's",
  "apps/docs/docs/glossary/layers.svg": "W · — · the glossary is FIX-1796's",
  "apps/docs/docs/glossary/workforce.svg": "W · — · the glossary is FIX-1796's",
  "apps/docs/docs/orchestration/discovery.md": "E · S12 · the inventory's mailboxes key in an example",
  "apps/docs/docs/orchestration/task-board.md": "E · S12 · \"A board a mailbox holds\" goes",
  "apps/docs/docs/shift-manager/overview.md": "E · S12 · workstreams read from mailboxes",
  "apps/docs/docs/workforce/built-in-worker.md": "E · S12 · taskLists from mailbox boards",
  "apps/docs/docs/workforce/chief-of-staff.md": "E · S12 · post-to-mailbox and setWorkstreams leave its tools",
  "apps/docs/docs/workforce/code-on-disk.md": "E · S12 · the flows/mailboxes slot and mailboxKinds go",
  "apps/docs/docs/workforce/durable-hire.md": "E · S12 · the mailboxBoards hire option goes",
  "apps/docs/docs/workforce/inventory.md": "E · S12 · mailbox and membership rows go",
  "apps/docs/docs/workforce/mailbox-or-room.svg": "T · — · FIX-1793 removes it with rooms",
  "apps/docs/docs/workforce/mailbox-parts.svg": "R · S12 · the removed page's figure",
  "apps/docs/docs/workforce/mailboxes.md": "R · S12 · the page; upgrading.md replaces it",
  "apps/docs/docs/workforce/overview.md": "E · S12 · the lines that teach MAILBOX.md; FIX-1796 rewrites the rest",
  "apps/docs/docs/workforce/project-overview.svg": "T · — · FIX-1793 redraws it",
  "apps/docs/docs/workforce/projects.md": "E · S12 · the mailbox list, claims and setWorkstreams sections go",
  "apps/docs/docs/workforce/seat-mailbox-records.svg": "R · S12 · a figure of the removed record",
  "apps/docs/docs/workforce/ui.md": "E · S12 · the Mailboxes rail group and mailboxBoard example",
  "apps/docs/docs/workforce/workforce-overview.svg": "E · S12 · the figure draws a MAILBOX.md",
  "apps/kitchen-sink/README.md": "C · S6 · the help desk is a coordinator",
  "apps/kitchen-sink/app/page.tsx": "C · S6 · the page talks to the help coordinator",
  "apps/kitchen-sink/components/flow-state/chat-assistant.tsx": "E · S6 · renders coordinator-route, not mailbox-route",
  "apps/kitchen-sink/components/picked-session-panel.tsx": "C · S6 · the picked conversation is the coordinator's",
  "apps/kitchen-sink/e2e/talk-from-page.spec.ts": "C · S6 · posts and escalations through the coordinator",
  "apps/kitchen-sink/e2e/workforce-shell.spec.ts": "C · S6 · the board panel reads the conversation's board",
  "apps/kitchen-sink/fsdev.config.ts": "C · S6 · mailbox wiring goes; the coordinator flow is on the list",
  "apps/kitchen-sink/lib/e2e-mock-script.ts": "C · S6 · the scripted replies name the coordinator",
  "apps/kitchen-sink/lib/mailbox-landing-control.ts": "C · S6 · a goal control re-expressed on the coordinator, or gone with its leg",
  "apps/kitchen-sink/lib/mailbox-post-control.ts": "C · S6 · a goal control re-expressed on the coordinator, or gone with its leg",
  "apps/kitchen-sink/lib/mailbox-route-control.ts": "C · S6 · a goal control re-expressed on the coordinator, or gone with its leg",
  "apps/kitchen-sink/lib/mailbox-wake-control.ts": "C · S6 · a goal control re-expressed on the coordinator, or gone with its leg",
  "apps/kitchen-sink/lib/models.ts": "E · S6 · a comment names mailbox-route",
  "apps/kitchen-sink/lib/workforce-shell.ts": "C · S6 · the escalations board ref becomes the conversation's board",
  "apps/kitchen-sink/test/client-imports.test.ts": "E · S6 · MAILBOX_POST_COMPONENT import",
  "apps/kitchen-sink/test/e2e-mock-script.test.ts": "C · S6 · tests",
  "apps/kitchen-sink/test/escalate.test.ts": "C · S6 · escalate files on the conversation's board",
  "apps/kitchen-sink/test/goal-control.test.ts": "C · S6 · tests",
  "apps/kitchen-sink/test/mailbox-reply.test.ts": "C · S6 · a delegate's answer, not post-to-mailbox",
  "apps/kitchen-sink/test/mailbox-talk.test.ts": "C · S6 · tests",
  "apps/kitchen-sink/test/mailbox-wake.test.ts": "C · S6 · tests",
  "apps/kitchen-sink/test/mock-flowstate.ts": "C · S6 · tests",
  "apps/kitchen-sink/test/named-org.test.ts": "C · S6 · the flow list loses mailbox; org identity kept",
  "apps/kitchen-sink/test/picked-session-panel.test.tsx": "C · S6 · tests",
  "apps/kitchen-sink/test/support-desk.test.ts": "C · S6 · the unattended-board warning goes",
  "apps/kitchen-sink/test/workforce-shell.test.ts": "C · S6 · tests",
  "apps/kitchen-sink/workforce/blocks/escalate.ts": "R · S6 · the tool goes; an Escalate: line in the answer replaces it",
  "apps/kitchen-sink/workforce/hire.ts": "C · S6 · mailbox binder calls go",
  "apps/kitchen-sink/workforce/mailbox-notify.ts": "R · S6 · the mailbox's notify block",
  "apps/kitchen-sink/workforce/teams/support/workers/accounts/WORKER.md": "C · S6 · post-to-mailbox and escalate leave its tools; an escalating answer ends with an Escalate: line",
  "apps/kitchen-sink/workforce/teams/support/workers/devices/WORKER.md": "C · S6 · post-to-mailbox and escalate leave its tools; an escalating answer ends with an Escalate: line",
  "apps/kitchen-sink/workforce/teams/support/workers/fsd/WORKER.md": "C · S6 · post-to-mailbox and escalate leave its tools; an escalating answer ends with an Escalate: line",
  "apps/kitchen-sink/workforce/teams/support/workers/general/WORKER.md": "C · S6 · post-to-mailbox and escalate leave its tools; an escalating answer ends with an Escalate: line",
  "apps/kitchen-sink/workforce/workforce.gen.ts": "C · S6 · regenerated with no mailboxKinds",
  "docs/architecture/resource-collections.md": "E · S12 · mailboxTaskLists as the example",
  "docs/atlas/workforce.html": "W · — · the internal atlas; FIX-1796's sweep",
  "packages/cli/README.md": "E · S12 · fsdev gen's flows/mailboxes slot",
  "packages/contracts/src/types/manifest.ts": "E · S9 · MailboxManifest named in the header",
  "packages/core/src/manifest/discovery-tools.ts": "E · S9 · discover's description drops the mailboxes domain",
  "packages/core/test/manifest-discovery.test.ts": "E · S9 · a mailboxes source as an out-of-scope example",
  "packages/devtool/src/react/components/workspace/inventory-view.tsx": "E · S9 · mailbox and membership rows go",
  "packages/devtool/src/react/lib/inventory.ts": "E · S9 · mailbox and membership rows go",
  "packages/devtool/test/inventory-view.test.tsx": "E · S9 · tests",
  "packages/harness-manager/README.md": "E · S12 · mailboxBoard example becomes a workstream's",
  "packages/react/README.md": "E · S12 · a rail group on kind mailbox",
  "packages/react/test/flow-navigator-second-host.test.ts": "E · S9 · filters on kind mailbox",
  "packages/shift-manager/README.md": "E · S12 · workstreams and the DevTeam's mailboxes",
  "packages/shift-manager/src/components/flow-state/chat-assistant.tsx": "E · S8 · renders coordinator-route",
  "packages/shift-manager/src/lib/reads.ts": "E · S8 · mailbox and claim reads go",
  "packages/shift-manager/src/lib/talk.ts": "T · — · FIX-1793 removes the room client; names MailboxTranscriptLine",
  "packages/shift-manager/src/lib/task.tsx": "E · S8 · a task's board ref",
  "packages/shift-manager/src/lib/transcript.ts": "E · S8 · mailbox transcript lines",
  "packages/shift-manager/src/surfaces/Project.tsx": "E · S8 · MailboxTranscriptLine, after FIX-1793 moves the Stream tab",
  "packages/shift-manager/src/surfaces/Stream.tsx": "T · — · FIX-1793 removes the Stream tab; names MailboxTranscriptLine",
  "packages/shift-manager/src/surfaces/TaskFrame.tsx": "E · S8 · mailboxOf goes with the board ref",
  "packages/shift-manager/src/surfaces/Workstream.tsx": "E · S8 · a workstream reads its entry and lead session",
  "packages/shift-manager/teams/devteam/README.md": "C · S7 · the DevTeam's coordinators and workstreams",
  "packages/shift-manager/teams/devteam/board.mts": "C · S7 · the feature board is the coordinator conversation's",
  "packages/shift-manager/teams/devteam/fsdev.config.mts": "C · S7 · no mailbox list and no workstream; the DevTeam's come with FIX-1802",
  "packages/shift-manager/teams/devteam/host.mts": "C · S7 · mailbox wiring goes",
  "packages/shift-manager/teams/devteam/notify.mts": "C · S7 · the mailbox wake goes",
  "packages/shift-manager/teams/devteam/phase.mts": "E · S7 · a comment hands the mailbox its charter",
  "packages/shift-manager/teams/devteam/workforce/flows/workers/coder.mts": "C · S7 · reads its coordinator conversation's board; no claim",
  "packages/shift-manager/teams/devteam/workforce/flows/workers/em.mts": "C · S7 · answers what to file; its coordinator files it",
  "packages/shift-manager/teams/devteam/workforce/org/workers/chief-of-staff/WORKER.md": "C · S7 · post-to-mailbox and setWorkstreams leave its tools",
  "packages/shift-manager/test/build-inputs.test.ts": "E · S8 · tests",
  "packages/shift-manager/test/chief-of-staff.test.ts": "E · S8 · workstreams as mailboxes in a fixture",
  "packages/shift-manager/test/columns.test.ts": "E · S8 · tests",
  "packages/shift-manager/test/devforce-lab-hired-boot.test.ts": "C · S7 · tests",
  "packages/shift-manager/test/devteam-legacy-org.test.ts": "E · S7 · an old store's mailbox session stays unread",
  "packages/shift-manager/test/devteam-pre-rename-store.test.ts": "E · S7 · the pre-rename store check stays; its fixture's mailbox goes",
  "packages/shift-manager/test/devteam-repository-ask.test.ts": "C · S7 · no claim; no project placement in the DevTeam until FIX-1802",
  "packages/shift-manager/test/fixtures/ask-lab/asker.mts": "C · S8 · the fixture lab's coordinator",
  "packages/shift-manager/test/fixtures/ask-lab/lab.mts": "C · S8 · the fixture lab's coordinator",
  "packages/shift-manager/test/fixtures/multi-seat-collab/README.md": "C · S8 · desks become delegates",
  "packages/shift-manager/test/fixtures/multi-seat-collab/figures/setup.svg": "C · S8 · redrawn with a coordinator",
  "packages/shift-manager/test/fixtures/multi-seat-collab/fsdev.config.mts": "C · S8 · desks become delegates",
  "packages/shift-manager/test/fixtures/multi-seat-collab/host.mts": "C · S8 · desks become delegates",
  "packages/shift-manager/test/fixtures/multi-seat-collab/workforce/flows/workers/planner.mts": "C · S8 · files for a delegate, not a desk",
  "packages/shift-manager/test/fixtures/multi-seat-collab/workforce/flows/workers/worker.mts": "C · S8 · takes the rows filed for it",
  "packages/shift-manager/test/fixtures/run-lab/lab.mts": "C · S8 · the fixture lab's coordinator",
  "packages/shift-manager/test/goal-labs.test.ts": "E · S8 · reads coordinators, not roster.mailboxes",
  "packages/shift-manager/test/projects.test.tsx": "E · S8 · workstreams are entries, not mailbox ids",
  "packages/shift-manager/test/reads.test.ts": "E · S8 · tests",
  "packages/shift-manager/test/roster-screen.test.tsx": "E · S8 · tests",
  "packages/shift-manager/test/roster.test.ts": "E · S8 · tests",
  "packages/shift-manager/test/shell-lines.test.ts": "E · S8 · tests",
  "packages/shift-manager/test/shell.test.tsx": "E · S8 · tests",
  "packages/shift-manager/test/static.test.ts": "E · S8 · tests",
  "packages/shift-manager/test/talk.test.ts": "T · — · FIX-1793 removes it with rooms",
  "packages/shift-manager/test/teams-roster.test.ts": "E · S8 · tests",
  "packages/shift-manager/test/turn-routes.test.ts": "E · S8 · tests",
  "packages/ui/registry/components/chat-assistant.tsx": "E · S9 · mailbox-route rendering goes",
  "packages/ui/test/substrate-components-never-raw.test.ts": "E · S9 · tests",
  "packages/workforce/README.md": "E · S12 · the mailbox floor's exports",
  "packages/workforce/src/agent-worker-flow.ts": "E · S9 · taskLists from mailbox boards go",
  "packages/workforce/src/browser.ts": "E · S9 · browser exports",
  "packages/workforce/src/codegen/discover.ts": "F · S2 · the flows/mailboxes slot is refused by name",
  "packages/workforce/src/codegen/index.ts": "E · S2 · the slot list",
  "packages/workforce/src/codegen/render.ts": "E · S2 · mailboxKinds is not rendered",
  "packages/workforce/src/hire.ts": "E · S9 · mailbox board ids leave the hire",
  "packages/workforce/src/index.ts": "E · S9 · package exports",
  "packages/workforce/src/inventory/collections.ts": "E · S9 · mailbox and membership rows go",
  "packages/workforce/src/inventory/index.ts": "E · S9 · mailbox and membership row exports",
  "packages/workforce/src/inventory/open-inventory.ts": "E · S9 · mailbox and membership rows go",
  "packages/workforce/src/loader/index.ts": "E · S1 · the loader's exports",
  "packages/workforce/src/loader/read-declared-roster.ts": "E · S1 · the roster has no mailboxes",
  "packages/workforce/src/loader/read-mailboxes-directory.ts": "F · S1 · becomes the refusal",
  "packages/workforce/src/mailbox-post-capability.ts": "R · S9 · post-to-mailbox",
  "packages/workforce/src/mailbox/index.ts": "R · S9 · the mailbox barrel",
  "packages/workforce/src/mailbox/mailbox-binder.ts": "R · S9 · the binder",
  "packages/workforce/src/mailbox/mailbox-board.ts": "R · S9 · org-scoped boards and mailboxTaskLists",
  "packages/workforce/src/mailbox/mailbox-flow.ts": "R · S9 · the mailbox flow",
  "packages/workforce/src/mailbox/mailbox-items.ts": "R · S9 · post lines, unless FIX-1791 took them over",
  "packages/workforce/src/mailbox/mailbox-post-line.ts": "R · S9 · post lines, unless FIX-1791 took them over",
  "packages/workforce/src/mailbox/mailbox-route.ts": "R · S9 · the mailbox's route record",
  "packages/workforce/src/mailbox/pre-rename.ts": "F · S3 · the CHANNEL.md refusal names the WORKER.md conversion",
  "packages/workforce/src/mailbox/route-by-purpose.ts": "R · S9 · the mailbox's wrapper over best fit",
  "packages/workforce/src/mailbox/wake-member-seats.ts": "R · S9 · the mailbox's wake",
  "packages/workforce/src/manifest-sources.ts": "E · S1 · mailbox records leave the sources",
  "packages/workforce/src/manifest.ts": "E · S1 · MailboxManifest goes",
  "packages/workforce/src/projects/cas-retry.ts": "E · S10 · its header names setWorkstreams",
  "packages/workforce/src/projects/collections.ts": "E · S10 · claims stop being declared; rows kept",
  "packages/workforce/src/projects/index.ts": "E · S10 · claim and setWorkstreams exports",
  "packages/workforce/src/projects/project-workspace.ts": "E · S10 · the claim path goes",
  "packages/workforce/src/projects/project-writes.ts": "E · S10 · setWorkstreams and claims go",
  "packages/workforce/src/projects/talk-template.ts": "T · — · FIX-1793 removes it with rooms",
  "packages/workforce/src/projects/talk.ts": "T · — · FIX-1793 removes it with rooms",
  "packages/workforce/src/seat-hire-blocks.ts": "E · S9 · the mailboxBoards hire option",
  "packages/workforce/test/agent-routed-answer.test.ts": "R · S9 · a routed mailbox answer; FIX-1791's delegated post replaces it",
  "packages/workforce/test/agent-worker-history.test.ts": "E · S9 · its wake fixture",
  "packages/workforce/test/agent-worker-mailbox-post.test.ts": "R · S9 · tests of the agent's onMailboxPost entry; FIX-1791 S9's delegated post replaces it",
  "packages/workforce/test/browser-exports.test-d.ts": "E · S9 · browser exports",
  "packages/workforce/test/browser-subpath-safe.test.ts": "E · S9 · exports",
  "packages/workforce/test/codegen-resource-modules.test.ts": "E · S2 · tests",
  "packages/workforce/test/codegen.test.ts": "E · S2 · the slot refused",
  "packages/workforce/test/cross-org-collection-read.test.ts": "E · S9 · its mailbox-board case goes",
  "packages/workforce/test/inventory-binder.test.ts": "E · S9 · tests",
  "packages/workforce/test/inventory-collections.test.ts": "E · S9 · tests",
  "packages/workforce/test/mailbox-binder.test.ts": "R · S9 · tests of the binder",
  "packages/workforce/test/mailbox-board-actions.test.ts": "R · S9 · tests of boardActions",
  "packages/workforce/test/mailbox-board-attendance.test.ts": "R · S9 · tests of the unattended-board warning",
  "packages/workforce/test/mailbox-board-tools.test.ts": "R · S9 · tests of mailbox board tools",
  "packages/workforce/test/mailbox-boards.test.ts": "R · S9 · tests of mailbox boards",
  "packages/workforce/test/mailbox-concurrency.test.ts": "R · S9 · tests of the mailbox flow",
  "packages/workforce/test/mailbox-fan-out.test.ts": "R · S9 · tests of the mailbox flow",
  "packages/workforce/test/mailbox-flow.test.ts": "R · S9 · tests of the mailbox flow",
  "packages/workforce/test/mailbox-org-identity.test.ts": "R · S9 · tests of the mailbox flow; org identity is the coordinator's suite's",
  "packages/workforce/test/mailbox-post-capability.test.ts": "R · S9 · tests of post-to-mailbox",
  "packages/workforce/test/mailbox-post-fences.test.ts": "R · S9 · tests of the mailbox flow",
  "packages/workforce/test/mailbox-post-items.test.ts": "R · S9 · tests of the mailbox flow",
  "packages/workforce/test/mailbox-rename-check.test.ts": "E · S3 · the rename guard's allow list",
  "packages/workforce/test/mailbox-route.test.ts": "R · S9 · tests of the mailbox route",
  "packages/workforce/test/mailbox-routing-binder.test.ts": "R · S9 · tests of the binder",
  "packages/workforce/test/mailbox-substrate-premises.test.ts": "R · S9 · tests of the mailbox flow",
  "packages/workforce/test/manifest-sources.test.ts": "E · S1 · tests",
  "packages/workforce/test/merge-seat-flows.test.ts": "E · S9 · a mailbox flow key in an example",
  "packages/workforce/test/pre-rename.test.ts": "F · S3 · tests",
  "packages/workforce/test/project-talk-template.test.ts": "T · — · FIX-1793 removes it with rooms",
  "packages/workforce/test/project-workspace.test.ts": "E · S10 · the claim path goes",
  "packages/workforce/test/projects.test.ts": "E · S10 · setWorkstreams and claims go",
  "packages/workforce/test/published-tree-surface.test.ts": "E · S1 · tests",
  "packages/workforce/test/read-declared-roster.test.ts": "E · S1 · tests",
  "packages/workforce/test/read-mailboxes-directory.test.ts": "F · S1 · becomes the refusal's tests",
  "packages/workforce/test/resources-doors-characterization.test.ts": "E · S1 · mailboxes/ decoy paths",
  "packages/workforce/test/seat-discovery.test.ts": "E · S9 · the mailboxes domain goes",
  "packages/workforce/test/seat-door.test.ts": "E · S9 · the roster's mailboxes field",
  "packages/workforce/test/seat-hire-capability.test.ts": "E · S9 · the mailboxBoards option",
  "packages/workforce/test/seat-id.test.ts": "E · S9 · tests",
  "packages/workforce/test/symlink-containment-matrix.test.ts": "E · S1 · tests",
  "packages/workforce/test/wake-member-seats.test-d.ts": "R · S9 · tests of the wake",
  "packages/workforce/test/wake-member-seats.test.ts": "R · S9 · tests of the wake",
  "packages/workforce/test/worker-task-hand-over.test.ts": "E · S9 · tests",
  "packages/workforce/test/workforce-capability-removed-keys.test-d.ts": "E · S9 · the roster's mailboxes field",
};

/**
 * Every goal unit that names the surface or says "mailbox". CONVERT: the
 * outcome holds, on the converted files. REWRITE: the epic changes the outcome,
 * and the goal states the new one. RETIRE: its subject is gone; the reason
 * names what proves the rest. FOLD: it becomes this issue's goal check. EDIT: a
 * field or a word, no behaviour. FIX-1793: rewritten there first, re-run here.
 */
const GOALS = {
  "goals/README.md": "EDIT · the word, FIX-1796",
  "goals/agent-discovery/an-orchestrator-routes-a-task-by-asking": "EDIT · a roster literal's mailboxes field",
  "goals/design-system/skins-reused-components-from-one-token-set": "EDIT · a rail label in a demo host",
  "goals/devforce-lab/it-codes-in-the-projects-repository": "RETIRE · a DevTeam run has no project until FIX-1802; FIX-1793's goal check proves a run placed through its workstream (BR-24)",
  "goals/devforce-lab/it-keeps-its-rows-on-the-mailboxes-board": "REWRITE · only the feature coordinator's user sees the rows; another member sees nothing",
  "goals/devforce-lab/it-ships-an-artifact-a-person-can-open": "CONVERT · posts to the feature coordinator",
  "goals/devforce-lab/it-waits-for-a-person-before-it-files": "CONVERT · the EM asks before its answer has the coordinator file",
  "goals/devforce-lab/it-wakes-the-seat-a-file-declared": "CONVERT · a filed row wakes the delegate it names",
  "goals/devtool-workforce-visibility/the-checklist-rows": "REWRITE · row 5 reads every worker and a coordinator's delegates",
  "goals/devtool-workforce-visibility/works-a-task-from-its-row": "CONVERT · the task is on a conversation's board",
  "goals/hire-plane/discover-survives-an-unaddressable-row": "EDIT · a roster literal's mailboxes field",
  "goals/kitchen-sink-talk/a-person-talks-to-a-seat-a-mailbox-and-back": "CONVERT · the help coordinator",
  "goals/kitchen-sink-talk/a-post-runs-each-member-agent-once": "CONVERT · the coordinator's judgment hands each post to one delegate",
  "goals/kitchen-sink-talk/agent-replies-in-the-mailbox": "CONVERT · the delegate's answer lands in the conversation",
  "goals/kitchen-sink-talk/answers-a-clerk-note-or-files-it": "CONVERT · an Escalate: line becomes a row the coordinator files on its board",
  "goals/kitchen-sink-talk/keeps-both-sides-across-a-reload": "CONVERT · the help coordinator",
  "goals/kitchen-sink-talk/lists-a-filed-case-without-a-reload": "CONVERT · the conversation's board, in every tab on it",
  "goals/kitchen-sink-talk/shows-the-reply-without-a-reload": "CONVERT · the help coordinator",
  "goals/mailbox-boards/it-hands-a-task-to-a-fresh-hire": "CONVERT · hire, add as a delegate, file",
  "goals/mailbox-boards/it-runs-a-row-a-file-declared-board-holds": "CONVERT · a file-declared coordinator's board runs a filed row; the FIX-1611 extras go",
  "goals/manager-queue-lab/it-routes-a-queue-to-the-seats-their-files-name": "REWRITE · a row names its delegate, not a desk",
  "goals/manager-queue-lab/it-stands-the-team-and-its-board-up-from-files": "REWRITE · a WORKER.md declaring boards: is refused by name",
  "goals/manager-queue-lab/lab": "REWRITE · the lab both manager-queue goals share",
  "goals/multi-seat-collab/it-hands-a-row-between-two-seats-in-view": "REWRITE · the planner files for delegates, not desks",
  "goals/multi-seat-collab/run-scenario.mts": "REWRITE · the scenario that goal runs",
  "goals/org-seats/cos-changes-the-roster": "REWRITE · who is on a coordinator is its delegate read, not discover",
  "goals/pentest-lab/a-post-reaches-both-declared-seats": "REWRITE · BR-10's unknown member is refused at load, not skipped",
  "goals/pentest-lab/a-seat-answers-from-its-own-document": "CONVERT · posts to the findings coordinator",
  "goals/pentest-lab/lab": "CONVERT · the lab both pentest goals share",
  "goals/shift-manager/a-lab-is-worked-through-one-skinned-shell": "CONVERT · the shell on converted labs",
  "goals/shift-manager/it-briefs-and-talks-with-the-chief-of-staff": "CONVERT · the summary counts conversation boards",
  "goals/shift-manager/it-draws-v2s-look": "CONVERT · screens draw conversation boards",
  "goals/shift-manager/it-groups-workstreams-under-their-projects": "FIX-1793 · rewritten to entries there; re-run here",
  "goals/shift-manager/it-hands-a-run-the-work-it-approved": "CONVERT · posts to the feature coordinator",
  "goals/shift-manager/it-opens-a-lab": "REWRITE · the DevTeam's feature opens as its coordinator's conversation; only its user sees the board",
  "goals/shift-manager/it-runs-from-an-install": "CONVERT · finds the coordinator whose conversation holds a board",
  "goals/shift-manager/it-sends-a-turn-into-a-seat-session": "CONVERT · @worker in a workstream",
  "goals/shift-manager/it-shows-and-stops-a-task-run": "CONVERT · finds the coordinator whose conversation holds a board",
  "goals/shift-manager/it-shows-who-is-on-shift": "CONVERT · the roster reads conversation boards",
  "goals/shift-manager/it-takes-its-look-from-the-design-system": "CONVERT · finds the coordinator whose conversation holds a board",
  "goals/shift-manager/one-person-runs-a-labs-projects-and-people": "CONVERT · after FIX-1793 retires its room legs, its MAILBOX.md key-list seam reads WORKER.md",
  "goals/task-run-link/it-names-the-run-working-each-task": "CONVERT · rows on a conversation's board",
  "goals/workforce-conventions/a-mailbox-holds-the-work-a-seat-drains": "RETIRE · its subjects are gone (an unattended file board, a kind of its own, two boards on one mailbox); FIX-1791's and FIX-1794's goal checks and kitchen-sink-talk prove the rest",
  "goals/workforce-conventions/capabilities-come-from-files-alone": "EDIT · a generated module's empty mailboxKinds",
  "goals/workforce-conventions/code-comes-from-files-alone": "REWRITE · its flows/mailboxes leg becomes the refusal",
  "goals/workforce-mailboxes/a-fresh-host-wakes-its-member-agents": "CONVERT · routing: everyone",
  "goals/workforce-mailboxes/a-pre-rename-lab-is-refused-by-name": "FOLD · its tree and store legs move into goals/coordinators/refuses-a-mailbox-file-by-name",
  "goals/workforce-mailboxes/a-routed-post-gets-one-answer": "CONVERT · routing: best-fit, one answer",
  "goals/workforce-packages/a-held-package-reaches-one-worker": "EDIT · a generated module's empty mailboxKinds",
};

// ── The run ─────────────────────────────────────────────────────────────────

const git = (args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
const listFiles = () => [...new Set([...git(["ls-files"]), ...git(["ls-files", "--others", "--exclude-standard"])])].sort();
const read = (f) => { try { return readFileSync(f, "utf8"); } catch { return undefined; } };
const unitOf = (f) => { const p = f.split("/"); return p.length > 3 ? `goals/${p[1]}/${p[2]}` : f; };

/** Every name declared `export` at the top of a file. */
const declaredExports = (text) =>
  [...text.matchAll(/^export (?:declare )?(?:default )?(?:async )?(?:const|let|function\*?|type|interface|class|enum|abstract class) ([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);

/**
 * Part 3's totality: every export a removed package-source file declares, and
 * every mailbox- or claim-named export in package source, is listed as removed
 * or kept. An export nobody listed is one `--after` could not see.
 */
function exportProblems(files) {
  const problems = [];
  const listed = new Set([...REMOVED_EXPORTS, ...Object.keys(KEPT_EXPORTS)]);
  for (const f of files) {
    if (!/^packages\/[^/]+\/src\//.test(f) || !/\.(ts|tsx|mts|js|mjs)$/.test(f)) continue;
    const text = read(f);
    if (text === undefined) continue;
    const removedWhole = FILE_CLASS[f]?.startsWith("R");
    for (const name of declaredExports(text)) {
      if (listed.has(name)) continue;
      if (removedWhole || SURFACE_NAME.test(name)) problems.push(`export in no removal list: ${name} (${f})`);
    }
  }
  return problems;
}

function run(mode) {
  const files = listFiles();
  const problems = [];

  // Part 1
  const mailboxes = files.filter((f) => f.endsWith("/MAILBOX.md") || f === "MAILBOX.md");
  const census = { files: 0, withBoards: 0, boards: 0, boardActions: 0, mintFor: 0, flow: 0, routing: 0, emptyMembers: 0 };
  const byTarget = {};
  for (const f of mailboxes) {
    const fm = frontmatter(read(f) ?? "");
    census.files += 1;
    if (fm.boards.length > 0) census.withBoards += 1;
    census.boards += fm.boards.length;
    for (const k of ["boardActions", "mintFor", "flow", "routing"]) if (fm.keys.has(k)) census[k] += 1;
    if (Array.isArray(fm.members) && fm.members.length === 0) census.emptyMembers += 1;
    const row = FILES[f];
    if (!row) { problems.push(`unclassified MAILBOX.md: ${f}`); continue; }
    byTarget[row.target] = (byTarget[row.target] ?? 0) + 1;
    if (row.boards.join(",") !== fm.boards.join(",")) problems.push(`boards differ for ${f}: table [${row.boards}] file [${fm.boards}]`);
  }
  for (const f of Object.keys(FILES)) if (!mailboxes.includes(f) && mode !== "after") problems.push(`listed but not found: ${f}`);

  // Part 2
  const classed = {};
  const unitsSeen = {};
  const goalUnits = new Set();
  const afterHits = [];
  for (const f of files) {
    if (SKIP(f) || f.endsWith("MAILBOX.md")) continue;
    const text = read(f);
    if (text === undefined) continue;
    const names = SURFACE.test(text) || REMOVED_NAME.test(text);
    if (f.startsWith("goals/")) {
      if (names || /mailbox/i.test(text)) goalUnits.add(unitOf(f));
    } else if (names) {
      const c = FILE_CLASS[f];
      if (!c) problems.push(`unclassified: ${f}`);
      else classed[c[0]] = (classed[c[0]] ?? 0) + 1;
    }
    if (mode === "after" && REMOVED_NAME.test(text) && !REFUSAL_HOMES.some((h) => f.startsWith(h))) afterHits.push(`${f} (${REMOVED_NAME.exec(text)[1]})`);
  }
  for (const u of goalUnits) {
    const d = GOALS[u];
    if (!d) problems.push(`unclassified goal: ${u}`);
    else { const k = d.split(" ")[0]; unitsSeen[k] = (unitsSeen[k] ?? 0) + 1; }
  }
  const stale = Object.keys(FILE_CLASS).filter((f) => !files.includes(f));

  if (mode === "after") {
    const left = mailboxes.filter((f) => !AFTER_FIXTURES.includes(f));
    if (left.length > 0) problems.push(`still a MAILBOX.md: ${left.join(", ")}`);
    for (const f of AFTER_FIXTURES) if (!mailboxes.includes(f)) problems.push(`refusal fixture missing: ${f}`);
    for (const f of afterHits) problems.push(`names a removed export: ${f}`);
    // S9: discovery's `mailboxes` domain leaves the pinned list (a value, not an export).
    const domains = /MANIFEST_DOMAINS\s*=\s*\[([^\]]*)\]/.exec(read(MANIFEST_DOMAINS_FILE) ?? "");
    if (!domains) problems.push(`MANIFEST_DOMAINS not found in ${MANIFEST_DOMAINS_FILE}`);
    else if (/["'`]mailboxes["'`]/.test(domains[1])) problems.push(`MANIFEST_DOMAINS still lists mailboxes: ${MANIFEST_DOMAINS_FILE}`);
  } else {
    for (const [k, v] of Object.entries(EXPECT)) if (census[k] !== v) problems.push(`census ${k}: want ${v}, got ${census[k]}`);
    problems.push(...exportProblems(files));
  }

  return { census, byTarget, classed, unitsSeen, goalUnits: goalUnits.size, stale, problems };
}

function report(r) {
  console.log(`census: ${JSON.stringify(r.census)}`);
  console.log(`targets: ${JSON.stringify(r.byTarget)}`);
  console.log(`files naming the surface: ${JSON.stringify(r.classed)} (R removed · E edited · C converted · F refusal · T FIX-1793 · W FIX-1796 · U unrelated)`);
  console.log(`goal units: ${r.goalUnits} ${JSON.stringify(r.unitsSeen)}`);
  if (r.stale.length) console.log(`classified but gone (re-check): ${r.stale.join(", ")}`);
  for (const p of r.problems) console.log(`FAIL ${p}`);
}

if (MODE === "control") {
  const plants = [
    // census: an unclassified file naming the surface
    ["packages/workforce/src/__fix1792_control__.ts", "export const x = openMailboxes;\n"],
    // census: an unclassified goal that says "mailbox" in prose only
    ["goals/__fix1792-control__/it-talks-in-a-mailbox/run.mts", "// posts to the desk's mailbox, in prose only\n"],
    // census: a mailbox-named export on no removal list
    ["packages/workforce/src/__fix1792_control_export__.ts", "export const mailboxControlPlant = 1;\n"],
    // after: names exports the first `--after` regex missed
    ["apps/kitchen-sink/lib/__fix1792_after__.ts", "// MAILBOX_ROUTE_COMPONENT emitMailboxPostLine MAILBOX_KIND mailboxKinds\n"],
  ];
  for (const [p, t] of plants) { mkdirSync(p.split("/").slice(0, -1).join("/"), { recursive: true }); writeFileSync(p, t); }
  let census;
  let after;
  try { census = run("census"); after = run("after"); } finally {
    for (const [p] of plants) rmSync(p, { force: true });
    rmSync("goals/__fix1792-control__", { recursive: true, force: true });
  }
  const has = (r, s) => r.problems.some((p) => p.includes(s));
  const oldFixtures = Object.keys(FILES).filter((f) => FILES[f].target === "fixture");
  const checks = {
    "census · unclassified source": has(census, "__fix1792_control__.ts"),
    "census · unclassified goal": has(census, "__fix1792-control__/it-talks-in-a-mailbox"),
    "census · unlisted export": has(census, "mailboxControlPlant"),
    "after · newly covered exports": has(after, "__fix1792_after__.ts"),
    "after · fixtures at their old paths": oldFixtures.length === 2 && oldFixtures.every((f) => has(after, f)),
    "after · the mailboxes discovery domain": has(after, "MANIFEST_DOMAINS still lists mailboxes"),
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "caught" : "MISSED"} · ${k}`);
  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? "CONTROL PASS · every plant refused" : "CONTROL FAIL");
  process.exit(ok ? 0 : 1);
}

const r = run(MODE);
report(r);
console.log(r.problems.length === 0 ? "PASS" : `FAIL · ${r.problems.length} problem(s)`);
process.exit(r.problems.length === 0 ? 0 : 1);
