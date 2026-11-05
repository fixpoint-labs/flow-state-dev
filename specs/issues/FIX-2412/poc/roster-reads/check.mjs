// FIX-2412 spec evidence: every roster read in the three workforce apps, classified.
// Retained design evidence, not production code. Throwaway.
//
// Run from the repository root:
//   node specs/issues/FIX-2412/poc/roster-reads/check.mjs
//   FIX2412_CONTROL=plant node specs/issues/FIX-2412/poc/roster-reads/check.mjs   # must exit 1
//
// Totality: every non-test source file under Kitchen Sink's app, components and lib, Shift
// Manager's src and the Teammates lab's src is scanned. A site is a call of the workforce
// client's `roster()`, the Teammates adapter's `listWorkers`, or a use of Kitchen Sink's
// hand-kept `SHELL_COORDINATORS`. Every `file:line-text` must be classified below, and every
// classified site must still be found.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ROOTS = [
  "apps/kitchen-sink/app",
  "apps/kitchen-sink/components",
  "apps/kitchen-sink/lib",
  "packages/shift-manager/src",
  "labs/teammates/src"
];
const SITE = /\.roster\(\)|listWorkers\(|SHELL_COORDINATORS/;

/** Each site, keyed by file and a fragment of its line, and what this spec does with it. */
const CLASSIFIED = {
  // Views that read once today and follow the roster after (watchRoster).
  "apps/kitchen-sink/components/team-panel.tsx|.roster()": "moves: TeamPanel follows watchRoster; Retry and the one-shot read go",
  "packages/shift-manager/src/lib/roster.ts|read: workforce.roster()": "moves: useRoster follows watchRoster, one watch per connection, no longer keyed on the snapshot",
  "packages/shift-manager/src/components/DelegatesPanel.tsx|.roster()": "moves: the picker reads useRoster",
  "labs/teammates/src/adapter.ts|async listWorkers()": "moves: the adapter's roster verb becomes a watch over watchRoster",
  "labs/teammates/src/adapter.ts|const roster = await workforce.roster();": "moves: inside listWorkers, as above",
  "labs/teammates/src/adapter.ts|listWorkers(): Promise<WorkerRow[]>;": "moves: the LabAdapter verb's type",
  "labs/teammates/src/App.tsx|await adapter.listWorkers()": "moves: the App's boot and its re-reads after a hire and a fire follow the watch",
  // The hand-kept coordinator list.
  "apps/kitchen-sink/lib/workforce-shell.ts|export const SHELL_COORDINATORS": "removed: the rail derives coordinators from the roster's flows",
  "apps/kitchen-sink/lib/rail-sessions.ts|import { isCoordinatorFlow, SHELL_COORDINATORS }": "moves: the rail lists roster entries on a coordinator flow",
  "apps/kitchen-sink/lib/rail-sessions.ts|SHELL_COORDINATORS.map(": "moves: as above, read at each listing (the rail's liveness is FIX-2411's)",
  // Reads that stay one-shot, and why.
  "packages/shift-manager/src/lib/reads.ts|const entries = await workforce.roster();": "stays: the snapshot's own-workers map, refreshed with the snapshot (FIX-2409)",
  "labs/teammates/src/adapter.ts|const anyConversation": "stays: picks one conversation to read the message log through; not a view",
  "labs/teammates/src/adapter.ts|const hired = (await workforce.roster())": "stays: hire's own answer, finding the row it just wrote"
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === "test" || name === "__tests__") continue;
      yield* files(path);
    } else if (/\.(ts|tsx|mts)$/.test(name) && !/\.test\.|\.spec\./.test(name)) yield path;
  }
}

const sites = [];
let scanned = 0;
for (const root of ROOTS) {
  for (const path of files(join(ROOT, root))) {
    scanned++;
    const file = relative(ROOT, path);
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((text, index) => {
        // Doc comments name the call without making it.
        if (/^\s*(\*|\/\/|\/\*)/.test(text)) return;
        if (SITE.test(text)) sites.push({ file, line: index + 1, text: text.trim() });
      });
  }
}
if (process.env.FIX2412_CONTROL === "plant") {
  sites.push({ file: "labs/teammates/src/planted.ts", line: 1, text: "const rows = await workforce.roster();" });
}

const keyOf = (site) =>
  Object.keys(CLASSIFIED).find((key) => {
    const [file, fragment] = key.split("|");
    return file === site.file && site.text.includes(fragment);
  });

const unclassified = sites.filter((site) => keyOf(site) === undefined);
const found = new Set(sites.map(keyOf).filter(Boolean));
const missing = Object.keys(CLASSIFIED).filter((key) => !found.has(key));

const tally = {};
for (const site of sites) {
  const key = keyOf(site);
  if (key === undefined) continue;
  const verdict = CLASSIFIED[key].split(":")[0];
  tally[verdict] = (tally[verdict] ?? 0) + 1;
  console.log(`${verdict.padEnd(8)} ${site.file}:${site.line}`);
}
console.log(`\n${scanned} files scanned, ${sites.length} sites: ${JSON.stringify(tally)}`);

for (const site of unclassified) console.error(`UNCLASSIFIED ${site.file}:${site.line}  ${site.text}`);
for (const key of missing) console.error(`MISSING      ${key} (classified, no longer found)`);
if (unclassified.length > 0 || missing.length > 0) process.exit(1);
console.log("every roster read classified");
