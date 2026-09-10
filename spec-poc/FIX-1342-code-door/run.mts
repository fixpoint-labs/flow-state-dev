/**
 * FIX-1342 POC — does a code-defined worker already have a path to hire?
 *
 * The question the spec turns on. The claim under test is that the "second
 * door" needs no framework change: `hireWorkforce` already takes worker records
 * whatever their source, so an app composes the ones it read off disk with the
 * ones it imported itself, and hires the lot in one call.
 *
 * Graded by DEREFERENCE, not presence. The code worker's distinguishing setting
 * is a live function; the check CALLS it against a held-out subject and grades
 * the answer. A seat that merely *has* a `route` key — a fabricated string, a
 * default, a copy of another worker's — fails here rather than passing on shape.
 *
 * Throwaway. Real path, no model, nothing registered.
 *
 * Run: pnpm tsx spec-poc/FIX-1342-code-door/run.mts
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// Addressed by source path, not by package name: `spec-poc/` is deliberately outside the
// pnpm workspace (see spec-poc/README.md), so it has no node_modules link. This is the
// same shipped source a consumer gets from the package root and the ./loader subpath.
import { readWorkforceDirectory } from "../../packages/workforce/src/loader/index";
import { hireWorkforce } from "../../packages/workforce/src/index";
import { routerFlow, workerAgentFlow } from "./flows.mts";
// The second door, in full. An ordinary static import of the app's own file —
// bundler-safe, host-neutral, and the framework never sees a path.
//
// A NAMED export, deliberately — see step 0 for why the default export is the
// wrong contract to standardise on.
//
// The file is `worker.mts` rather than `worker.ts` only because `spec-poc/` is
// outside the workspace and carries no package.json (by its README's rule), so
// a `.ts` file here is CJS while a real FSD app is ESM. The filename under
// discussion in the issue is `worker.ts`; nothing else about this changes.
import { routerWorker } from "./workforce/teams/engineering/workers/router/worker.mts";
import * as routerModule from "./workforce/teams/engineering/workers/router/worker.mts";

const here = join(fileURLToPath(new URL(".", import.meta.url)));
const root = join(here, "workforce");

/** Held out from every implementation: the answers the live `route` must give. */
const ROUTING = [
  { subject: "Refund for a returns label", desk: "returns" },
  { subject: "Someone is spamming the abuse inbox", desk: "abuse" },
  { subject: "Card declined", desk: "billing" },
];

const failures: string[] = [];
const note = (line: string): number => failures.push(line);

// ─── 0. The export contract is not free. ─────────────────────────────────────
// Measured, not assumed. Under ESM (here) the default export arrives bare.
// Under CJS — the same file named `worker.ts` with no `"type": "module"` above
// it, which is how this POC first ran — it arrives as `{ default: { … } }`,
// double-wrapped by interop:
//
//     keys: [ 'default' ]
//     { "default": { "default": { "id": "engineering.router", … } } }
//
// So "a worker.ts default-exports its record" does not name one arrival shape.
// A framework-side loader would have to unwrap that by guesswork, on a module
// it did not write. A named export is the same object either way.
const namedIsRecord = routerWorker.id === "engineering.router";
if (!namedIsRecord) note("the named export is not the worker record");

const bareDefault = routerModule.default as { id?: string; default?: unknown } | undefined;
const defaultShape =
  bareDefault?.id !== undefined
    ? `bare here under ESM (id "${bareDefault.id}")`
    : "wrapped — not the record";

// ─── 1. Read the tree. Today's honest behaviour, unchanged. ──────────────────
const { workers, errors } = await readWorkforceDirectory(root);

const fromDisk = workers.map((w) => w.id).sort();
if (JSON.stringify(fromDisk) !== JSON.stringify(["engineering.analyst", "engineering.lead"])) {
  note(`loader returned [${fromDisk}] — expected the two document workers only`);
}

// The `worker.ts`-only folder occupies a worker slot and has no WORKER.md, so it
// is REPORTED. That is the behaviour the removal commit pinned, and the reason
// this issue exists: the author sees an error where they expected a door.
const reported = errors.map((e) => e.path);
if (!reported.includes("teams/engineering/workers/router")) {
  note(`the worker.ts-only folder was not reported; errors = [${reported}]`);
}

// ─── 2. Compose. The app's own two lines — this is the whole proposal. ───────
const roster = [...workers, routerWorker];

// ─── 3. Hire the lot in one call, on the shipped synchronous API. ────────────
const seats = hireWorkforce(roster, {
  kinds: { "worker-agent": workerAgentFlow, router: routerFlow },
});

const hired = seats.map((s) => s.id).sort();
const want = ["engineering.analyst", "engineering.lead", "engineering.router"].sort();
if (JSON.stringify(hired) !== JSON.stringify(want)) {
  note(`hired [${hired}] — expected [${want}]`);
}

// ─── 4. Grade the code seat by CALLING what only code could have supplied. ───
const router = seats.find((s) => s.id === "engineering.router");
if (router === undefined) {
  note("engineering.router was not hired at all");
} else {
  const config = router.config as { persona?: string; route?: (s: string) => string };

  if (typeof config.route !== "function") {
    note(`engineering.router's route survived the hire as ${typeof config.route}, not a function`);
  } else {
    for (const { subject, desk } of ROUTING) {
      const got = config.route(subject);
      if (got !== desk) note(`route("${subject}") returned "${got}" — the code says "${desk}"`);
    }
  }

  if (!config.persona?.includes("KESTREL-7781")) {
    note("engineering.router's instructions are not the ones its own module wrote");
  }
}

// ─── 5. Cross-contamination probe: each document seat kept its own body. ─────
for (const [id, marker] of [
  ["engineering.lead", "TIDEPOOL-4417"],
  ["engineering.analyst", "SANDPIPER-9023"],
] as const) {
  const seat = seats.find((s) => s.id === id);
  const persona = (seat?.config as { persona?: string } | undefined)?.persona ?? "";
  if (!persona.includes(marker)) note(`${id} does not carry its own instructions (${marker})`);
  if (persona.includes("KESTREL-7781")) note(`${id} carries the code worker's instructions`);
}

// ─── Verdict ─────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`FAIL — ${failures.length} problem(s):\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}

console.log(
  "PASS — a code-defined worker hires today, with no framework change.\n" +
    `  export contract  : the named export IS the record; the same module's default export is ${defaultShape},\n` +
    "                     and is double-wrapped under CJS (measured — see step 0)\n" +
    `  loader returned  : ${fromDisk.join(", ")}\n` +
    `  loader reported  : ${reported.join(", ")} (the worker.ts-only folder)\n` +
    `  hired in one call: ${hired.join(", ")}\n` +
    "  engineering.router's `route` was CALLED and returned " +
    `${ROUTING.map((r) => `"${r.desk}"`).join(", ")} — a live function a WORKER.md cannot express,\n` +
    "  carried through hireWorkforce onto the seat's frozen config.\n" +
    "  hireWorkforce stayed synchronous. Nothing was imported by the framework, nothing registered, no model ran.",
);
