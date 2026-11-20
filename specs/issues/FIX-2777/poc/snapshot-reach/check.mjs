#!/usr/bin/env node
// FIX-2777 snapshot reach — retained spec evidence, not production code.
//
// Re-derives the counted facts SPEC.md rests on, from the real tree: every
// file outside Shift Manager's three snapshot modules (`reads.ts`,
// `derive.ts`, `snapshot-subscribe.ts`) that still reaches one of them or the
// provider's snapshot, and how. FIX-2775's census already proves no screen
// does; this one covers what it does not scan: tests, test helpers, goals and
// goal controls.
//
// A file reaches the snapshot when it
//   - imports a module (`from "…"`, `import("…")`, `vi.mock("…")`), the
//     specifier resolved against the file, so `./reads` in `src/lib/` and
//     `../src/lib/reads` in `test/` both count;
//   - names a module's file in any string literal (`"reads.ts"`,
//     `"lib/reads.ts"`, `join(src, "lib", "reads.ts")`): a goal that swaps it
//     at build time, however the swap's path is built (`swapOf("reads.ts", …)`
//     included), or reads its source;
//   - stands in for the reader (`createLabReader` outside the module);
//   - reads a snapshot field off the provider (`snapshot`, `reader`,
//     `refreshing`, `asking`): destructured (`{ snapshot } = useLab()`), by
//     member access on a `useLab()` result (`useLab().snapshot`, or
//     `const lab = useLab(); lab.snapshot`), or through a stand-in provider
//     that carries the field (`snapshot:` in a file that mocks `lab-data`, or
//     in a `lab-data` fake). FIX-2775's census checks `src/` only.
//
// Not seen: a file name built from fragments at run time (`name + ".ts"`).
// A goal's swap build must also fail when its swap is never reached, as
// `it-briefs-and-talks-with-the-shift-coordinator`'s does.
//
// Each reaching file is classified once, by hand, below. Totality: a reaching
// file nobody classified fails, and so does a classified file that no longer
// reaches. That is what stops the list from being the sites someone happened
// to look at.
//
//   node specs/issues/FIX-2777/poc/snapshot-reach/check.mjs                # check: counts are the spec's
//   node specs/issues/FIX-2777/poc/snapshot-reach/check.mjs --control      # plant one file per way to reach: FAIL naming each
//   node specs/issues/FIX-2777/poc/snapshot-reach/check.mjs --control=swap # one plant: import, swap, alias, member, mock, fake
//   node specs/issues/FIX-2777/poc/snapshot-reach/check.mjs --built        # the goal check: 0 reaching files, the three modules gone
//
// `--built` FAILS on today's main by design: it is the control for the
// implementation, and says so in a banner first.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const LIB = join(ROOT, "packages/shift-manager/src/lib");
const LAB_DATA = join(LIB, "lab-data.tsx");
const MODULES = ["reads", "derive", "snapshot-subscribe"];
const TARGETS = new Set(MODULES.map((m) => join(LIB, `${m}.ts`)));
const CONTROL_ARG = process.argv.find((arg) => arg === "--control" || arg.startsWith("--control="));
const BUILT = process.argv.includes("--built");
const failures = [];

// Measured on origin/main 372f30fa95.
const EXPECTED = {
  subject: 3, oracle: 25, fixture: 10, control: 5, source: 1, inventory: 1, lab: 1, provenance: 2, codemod: 2, probe: 5,
};

/**
 * Every reaching file, and what it uses the snapshot for:
 *  - subject:    the snapshot is what the test tests. It goes; each case is
 *                mapped to where its behaviour is covered now, or why it is gone.
 *  - oracle:     the test reads the Lab through the snapshot to check a fact
 *                about something else. It reads that fact through what a screen
 *                reads now; the assertion keeps its meaning.
 *  - fixture:    a test helper, a mock or a fake that builds a snapshot, or a
 *                provider carrying one, to feed a screen. Re-pointed at the reads
 *                the screen makes now; a snapshot field no screen reads goes.
 *  - control:    a goal control that swaps a snapshot module. It is re-aimed at
 *                the module that now carries the defect it plants, or retired
 *                with a reason; either way it is shown to fail its leg.
 *  - source:     a goal that reads a snapshot module's source text.
 *  - inventory:  the inventory settings naming the module.
 *  - lab:        `lab-data.tsx`, which keeps connection, client and health.
 *  - provenance: a comment that names the module (BP-034): reworded or dropped.
 *  - codemod:    a one-shot codemod that lists the module among its targets.
 *  - probe:      a goal whose headless probe waits on, draws from or counts the
 *                provider's snapshot. Its leg is re-pointed at the read that does
 *                that job now, or retired with a reason, and shown failing.
 */
const CLASSIFIED = {
  "packages/shift-manager/test/reads.test.ts": "subject",
  "packages/shift-manager/test/snapshot-subscribe.test.tsx": "subject",
  "packages/shift-manager/test/connection.test.tsx": "subject",

  "packages/shift-manager/test/teams-roster.test.ts": "oracle",
  "packages/shift-manager/test/task-actions.test.ts": "oracle",
  "packages/shift-manager/test/devteam-em-routines.test.ts": "oracle",
  "packages/shift-manager/test/devteam-em-workstream.test.ts": "oracle",
  "packages/shift-manager/test/devteam-org-inventory.test.ts": "oracle",
  "packages/shift-manager/test/devteam-workstream-routed-tasks.test.ts": "oracle",
  "packages/shift-manager/test/fsd-profile.test.ts": "oracle",
  "packages/shift-manager/test/goal-labs.test.ts": "oracle",
  "packages/shift-manager/test/inbox.test.ts": "oracle",
  "packages/shift-manager/test/projects.test.tsx": "oracle",
  "packages/shift-manager/test/project-workstreams.test.tsx": "oracle",
  "packages/shift-manager/test/task-screen.test.tsx": "oracle",
  "packages/shift-manager/test/static.test.ts": "oracle",
  "packages/shift-manager/test/board-task-mapper.test.ts": "oracle",
  "packages/shift-manager/test/distinct-title.test.ts": "oracle",
  "packages/shift-manager/test/columns.test.ts": "oracle",
  "packages/shift-manager/test/task-brief-files.test.tsx": "oracle",
  "packages/shift-manager/test/inbox-tasks.test.ts": "oracle",
  "packages/shift-manager/test/shift-coordinator.test.ts": "oracle",
  "goals/task-board/asks-a-person-one-way/run.mts": "oracle",
  "goals/task-board/waits-on-its-questions/run.mts": "oracle",
  "goals/task-board/holds-a-task-waiting-on-a-person/run.mts": "oracle",
  "goals/harness-manager/a-tool-call-waits-for-approval/run.mts": "oracle",
  "goals/harness-manager/a-runs-changes-wait-for-review/run.mts": "oracle",
  "goals/error-reporter/files-a-reproducible-issue/run.mts": "oracle",

  "packages/shift-manager/test/helpers/directory.ts": "fixture",
  "packages/shift-manager/test/helpers/inbox-view.ts": "fixture",
  "packages/shift-manager/test/roster-screen.test.tsx": "fixture",
  "packages/shift-manager/test/answer-follow.test.tsx": "fixture",
  "packages/shift-manager/test/worker-settings-screen.test.tsx": "fixture",
  "packages/shift-manager/test/jump-message.test.tsx": "fixture",
  "packages/shift-manager/test/task-card-in-feed.test.tsx": "fixture",
  "packages/shift-manager/test/conversation.test.tsx": "fixture",
  "packages/shift-manager/test/session-view.test.tsx": "fixture",
  "packages/shift-manager/test/task-session.test.tsx": "fixture",

  "goals/shift-manager/it-shows-and-stops-a-task-run/run.mts": "control",
  "goals/shift-manager/it-opens-a-lab/run.mts": "control",
  "goals/shift-manager/it-briefs-and-talks-with-the-shift-coordinator/run.mts": "control",
  "goals/shift-manager/it-shows-who-is-on-shift/controls/status-from-snapshot.ts": "control",
  "goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/run.mts": "control",

  "goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/parts.mts": "source",
  "packages/shift-manager/test/inventory-settings.ts": "inventory",
  "packages/shift-manager/src/lib/lab-data.tsx": "lab",
  "packages/shift-manager/test/inventory.test.ts": "provenance",
  "goals/lib/shift-manager.mts": "provenance",
  "scripts/codemod/rename-hold-words.ts": "codemod",
  "scripts/codemod/rename-question-hold-words.ts": "codemod",
  "goals/live-read/one-loop-every-watcher/run.mts": "probe",
  "goals/realtime/app-views-read-on-notice/run.mts": "probe",
  "goals/shift-manager/every-stop-is-one-inbox-item/no-conversation.mts": "probe",
  "goals/shift-manager/its-summary-changes-on-its-own/run.mts": "probe",
  "goals/conversation-scroll/sent-line-rises-reply-stays/pages/shift-manager/fakes/lab-data.ts": "probe",
};
// A swap control's own module imports the real module it wraps; it goes or moves with its run.mts.
const CONTROL_MODULES = new Set([
  "goals/shift-manager/it-shows-and-stops-a-task-run/controls/wrong-board.ts",
  "goals/shift-manager/it-opens-a-lab/controls/unanswerable-asks.ts",
  "goals/shift-manager/it-briefs-and-talks-with-the-shift-coordinator/controls/static-brief.ts",
]);

// The control's plants: one file per way to reach, each of which the check must name.
const PLANTS = {
  import: ["packages/shift-manager/test/planted-import.test.ts", 'import { heard } from "../src/lib/snapshot-subscribe";'],
  swap: ["goals/shift-manager/planted-goal/run.mts", 'const swap = swapOf("reads.ts", "it-opens-a-lab", "static-names.ts");'],
  alias: ["packages/shift-manager/test/planted-alias.test.tsx", "function Probe() {\n  const lab = useLab();\n  return lab.snapshot === undefined ? null : null;\n}"],
  member: ["packages/shift-manager/test/planted-member.test.tsx", "const drawn = useLab().snapshot;"],
  mock: ["packages/shift-manager/test/planted-mock.test.tsx", 'const lab = { client: {}, snapshot: { readAt: 1 } };\nvi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));'],
  fake: ["goals/planted-goal/pages/fakes/lab-data.ts", "export const useLab = () => ({ client, snapshot: undefined });"],
};
const planted = new Map();
if (CONTROL_ARG !== undefined) {
  const only = CONTROL_ARG.includes("=") ? CONTROL_ARG.slice("--control=".length) : undefined;
  if (only !== undefined && PLANTS[only] === undefined) throw new Error(`unknown plant "${only}"; known: ${Object.keys(PLANTS).join(", ")}`);
  for (const [name, [rel, text]] of Object.entries(PLANTS)) if (only === undefined || only === name) planted.set(join(ROOT, rel), text);
}

const SCAN = ["packages/shift-manager/src", "packages/shift-manager/test", "goals", "apps", "scripts"];
const EXT = /\.(ts|tsx|mts|mjs|js)$/;
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (EXT.test(name)) yield path;
  }
}

const SPECIFIER = /(?:from\s*|import\s*\(\s*|vi\.mock\(\s*|require\(\s*)["']([^"']+)["']/g;
const MOCK = /vi\.mock\(\s*["']([^"']+)["']/g;
/** `spec` at `file`, resolved, without its extension; undefined for a package specifier. */
const resolved = (file, spec) => (spec.startsWith(".") ? resolve(dirname(file), spec).replace(/\.(tsx?|mts|js)$/, "") : undefined);
const resolvesTo = (file, spec) => {
  const base = resolved(file, spec);
  return base !== undefined && TARGETS.has(`${base}.ts`) ? `${base}.ts` : undefined;
};
const FILE_NAME = new RegExp(`["'\`](?:[^"'\`\\s]*/)?(?:${MODULES.join("|")})\\.ts["'\`]`);
const FIELDS = "snapshot|reader|refreshing|asking";
const DESTRUCTURED = new RegExp(`\\{[^}]*\\b(?:${FIELDS})\\b[^}]*\\}\\s*=\\s*useLab\\(\\)`);
const MEMBER = new RegExp(`useLab\\(\\)\\??\\.(?:${FIELDS})\\b`);
const ALIAS = /(?:const|let|var)\s+(\w+)\s*=\s*useLab\(\)/g;
const STAND_IN_FIELD = new RegExp(`\\b(?:${FIELDS})\\s*:`);
const mocksLabData = (file, text) => [...text.matchAll(MOCK)].some(([, spec]) => `${resolved(file, spec)}.tsx` === LAB_DATA);
const isLabDataFake = (file) => file !== LAB_DATA && /(^|\/)lab-data\.(ts|tsx|mts)$/.test(file);

/** How `text`, at `file`, reaches the snapshot: empty when it doesn't. */
function reachOf(file, text) {
  const how = new Set();
  for (const [, spec] of text.matchAll(SPECIFIER)) if (resolvesTo(file, spec) !== undefined) how.add("import");
  if (FILE_NAME.test(text)) how.add("file name");
  if (/\bcreateLabReader\b/.test(text)) how.add("reader");
  if (DESTRUCTURED.test(text) || MEMBER.test(text)) how.add("provider field");
  for (const [, name] of text.matchAll(ALIAS)) {
    if (new RegExp(`\\b${name}\\??\\.(?:${FIELDS})\\b`).test(text)) how.add("provider field");
  }
  if ((mocksLabData(file, text) || isLabDataFake(file)) && STAND_IN_FIELD.test(text)) how.add("stand-in provider");
  return how;
}

const reaching = new Map();
const files = [...SCAN.flatMap((dir) => [...walk(join(ROOT, dir))]), ...planted.keys()];
for (const file of files) {
  if (TARGETS.has(file)) continue;
  const how = reachOf(file, planted.get(file) ?? readFileSync(file, "utf8"));
  if (how.size > 0) reaching.set(relative(ROOT, file), [...how]);
}

if (BUILT) {
  console.log("GOAL CHECK: run on the implementation. Before it lands, FAIL here is expected: it is the control.");
  for (const target of TARGETS) if (existsSync(target)) failures.push(`still on disk: ${relative(ROOT, target)}`);
  for (const [rel, how] of reaching) failures.push(`still reaches the snapshot: ${rel} (${how.join(", ")})`);
} else {
  const counts = {};
  for (const [rel, how] of reaching) {
    if (CONTROL_MODULES.has(rel)) continue;
    const kind = CLASSIFIED[rel];
    if (kind === undefined) {
      failures.push(`reaches the snapshot, unclassified: ${rel} (${how.join(", ")})`);
      continue;
    }
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  for (const rel of [...Object.keys(CLASSIFIED), ...CONTROL_MODULES]) {
    if (!reaching.has(rel)) failures.push(`classified, but no longer reaches the snapshot: ${rel}`);
  }
  for (const [kind, n] of Object.entries(EXPECTED)) {
    if ((counts[kind] ?? 0) !== n) failures.push(`${kind}: ${counts[kind] ?? 0} files, the spec says ${n}`);
  }
  console.log(`reaching files: ${reaching.size} (${CONTROL_MODULES.size} of them control modules) · by kind: ${JSON.stringify(counts)}`);

  // What the swap controls swap, and which src files still import it: a swapped module no
  // screen imports cannot change what a screen draws.
  for (const target of TARGETS) {
    const importers = [...walk(join(ROOT, "packages/shift-manager/src"))]
      .filter((file) => !TARGETS.has(file) && [...readFileSync(file, "utf8").matchAll(SPECIFIER)].some(([, spec]) => resolvesTo(file, spec) === target))
      .map((file) => relative(ROOT, file));
    console.log(`src files outside the three that import ${relative(ROOT, target)}: ${JSON.stringify(importers)}`);
  }
}

if (failures.length > 0) {
  console.log("FAIL");
  for (const failure of failures) console.log(`  ${failure}`);
  process.exit(1);
}
console.log("PASS");
