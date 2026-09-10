/**
 * Goal check — a folder tree an author actually writes produces the roster.
 *
 * Two teams, a worker called `lead` in each, a thin seat with no instructions,
 * a mistyped worker file, and a team-level knowledge folder. Read the root once
 * and the app has its workers: right identities, right settings, each one's own
 * instructions, the mistyped folder named, and the knowledge folder passed over.
 *
 * Nothing is registered anywhere in this path and no worker is written in
 * TypeScript. Real path, no model. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/workforce-conventions/files-alone-produce-the-roster/run.mts
 */
import { join } from "node:path";
import { readWorkforceDirectory } from "@flow-state-dev/workforce/loader";
import { fixtureDir, loadFixture, runGoal } from "../../lib/index.mts";

type Expected = {
  id: string;
  marker: string | null;
  declared: Record<string, unknown>;
};
type Fixture = {
  root: string;
  expect: Expected[];
  expectErrorPaths: string[];
  silentPaths: string[];
};

const fixture = loadFixture<Fixture>(import.meta.url);
const root = join(fixtureDir(import.meta.url), fixture.root);

await runGoal(async () => {
  const { workers, errors } = await readWorkforceDirectory(root);
  const failures: string[] = [];

  // 1. The roster is exactly the set the tree describes — no more, no fewer.
  const got = workers.map((w) => w.id).sort();
  const want = fixture.expect.map((e) => e.id).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures.push(`roster is [${got}] — the tree describes [${want}]`);
  }

  for (const expected of fixture.expect) {
    const worker = workers.find((w) => w.id === expected.id);
    if (!worker) continue; // already reported by the roster check

    // 2. Every setting the folder declared arrived, spelled as the file spelled it.
    if (JSON.stringify(worker.declared) !== JSON.stringify(expected.declared)) {
      failures.push(
        `${expected.id} declared ${JSON.stringify(worker.declared)} — the file says ` +
          `${JSON.stringify(expected.declared)}`,
      );
    }

    // 3. Each worker got ITS OWN instructions. The marker is held out in the
    //    fixture and appears in exactly one folder on the tree, so a loader
    //    that handed every worker the same body — or a default one — fails
    //    here rather than passing on a shape check.
    if (expected.marker === null) {
      if (worker.body.trim().length > 0) {
        failures.push(
          `${expected.id} has instructions it was never given: ${JSON.stringify(worker.body.slice(0, 80))}`,
        );
      }
    } else if (!worker.body.includes(expected.marker)) {
      failures.push(
        `${expected.id} is missing its own marker ${expected.marker}: ` +
          JSON.stringify(worker.body.slice(0, 80)),
      );
    }

    // 4. And nobody else's. Two workers are both called `lead`; if the walk
    //    keyed anything by bare name, one body would land on both.
    for (const other of fixture.expect) {
      if (other.id === expected.id || other.marker === null) continue;
      if (worker.body.includes(other.marker)) {
        failures.push(`${expected.id} carries ${other.id}'s instructions (${other.marker})`);
      }
    }
  }

  // 5. The mistyped folder is named, so the app can refuse to boot short.
  const reported = errors.map((e) => e.path).sort();
  if (JSON.stringify(reported) !== JSON.stringify([...fixture.expectErrorPaths].sort())) {
    failures.push(`reported [${reported}] — expected [${fixture.expectErrorPaths}]`);
  }

  // 6. And the team's knowledge folder is not, however worker-shaped it looks.
  for (const quiet of fixture.silentPaths) {
    if (reported.some((p) => p.startsWith(quiet))) {
      failures.push(`reported "${quiet}", which is not a worker slot`);
    }
  }

  return {
    failures,
    evidence:
      `${workers.length} workers read from files alone at ${root}: ` +
      `${workers.map((w) => w.id).join(", ")}; ` +
      `${errors.length} slot(s) reported (${reported.join(", ") || "none"}). ` +
      `Each body matched the held-out marker written only in its own folder, and no ` +
      `body carried another worker's. Nothing was registered and no model ran.`,
  };
});
