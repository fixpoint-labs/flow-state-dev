/**
 * Goal check — a folder tree an author actually writes produces the documents.
 *
 * An org-wide document, two teams that each have a `handbook`, a folder where a
 * file should be, and a stray text file. Read the root once and the app has its
 * documents: right refs, right settings, each one's own body, the folder-shaped
 * mistake named, the stray file passed over — and the map an L1 flow accepts.
 *
 * Nothing is registered anywhere in this path and no document is written in
 * TypeScript. Real path, no model. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/workforce-conventions/documents-come-from-files-alone/run.mts
 */
import { join } from "node:path";
import { defineFlow } from "@flow-state-dev/core";
import { readResourcesDirectory } from "@flow-state-dev/workforce/loader";
import { resourcesFromDocs } from "@flow-state-dev/workforce";
import { fixtureDir, loadFixture, runGoal } from "../../lib/index.mts";

type Expected = {
  ref: string;
  marker: string;
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
  const { documents, errors } = await readResourcesDirectory(root);
  const failures: string[] = [];

  // 1. The documents are exactly the set the tree describes — no more, no
  //    fewer, and keyed the way the atlas keys them.
  const got = documents.map((d) => d.ref).sort();
  const want = fixture.expect.map((e) => e.ref).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures.push(`documents are [${got}] — the tree describes [${want}]`);
  }

  for (const expected of fixture.expect) {
    const document = documents.find((d) => d.ref === expected.ref);
    if (!document) continue; // already reported by the set check

    // 2. Every setting the file declared arrived, spelled as the file spelled it.
    if (JSON.stringify(document.declared) !== JSON.stringify(expected.declared)) {
      failures.push(
        `${expected.ref} declared ${JSON.stringify(document.declared)} — the file says ` +
          `${JSON.stringify(expected.declared)}`,
      );
    }

    // 3. Each document got ITS OWN body. The marker is held out in the fixture
    //    and appears in exactly one file on the tree, so a reader that handed
    //    every document the same body fails here rather than passing a shape
    //    check.
    if (!document.body.includes(expected.marker)) {
      failures.push(
        `${expected.ref} is missing its own marker ${expected.marker}: ` +
          JSON.stringify(document.body.slice(0, 80)),
      );
    }

    // 4. And nobody else's. Two teams both have a `handbook`; if the walk keyed
    //    anything by bare name, one body would land on both.
    for (const other of fixture.expect) {
      if (other.ref === expected.ref) continue;
      if (document.body.includes(other.marker)) {
        failures.push(`${expected.ref} carries ${other.ref}'s body (${other.marker})`);
      }
    }
  }

  // 5. The folder where a file should be is named, so the app can refuse to
  //    boot a team short. This is the mistake the convention most expects,
  //    because every other slot in the tree IS folder-per-thing.
  const reported = errors.map((e) => e.path).sort();
  if (JSON.stringify(reported) !== JSON.stringify([...fixture.expectErrorPaths].sort())) {
    failures.push(`reported [${reported}] — expected [${fixture.expectErrorPaths}]`);
  }

  // 6. And the stray file is not, because nobody declared it as a document.
  for (const quiet of fixture.silentPaths) {
    if (reported.some((p) => p === quiet || p.startsWith(`${quiet}/`))) {
      failures.push(`reported "${quiet}", which nobody declared as a document`);
    }
  }

  // 7. The records become a resource map a flow takes as-is — including the
  //    slashed accessor keys a team document is named with.
  let installed: string[] = [];
  try {
    const flow = defineFlow({
      kind: "support",
      actions: {},
      resources: resourcesFromDocs(documents),
    });
    installed = Object.keys(flow.resources ?? {}).sort();
    if (JSON.stringify(installed) !== JSON.stringify(want)) {
      failures.push(`the flow installed [${installed}] — expected [${want}]`);
    }
    for (const expected of fixture.expect) {
      const entry = flow.resources?.[expected.ref] as { content?: string } | undefined;
      if (entry?.content === undefined || !entry.content.includes(expected.marker)) {
        failures.push(`${expected.ref} reached the flow without its own body`);
      }
    }
  } catch (err) {
    failures.push(`the flow refused the map read from files: ${(err as Error).message}`);
  }

  return {
    failures,
    evidence:
      `${documents.length} documents read from files alone at ${root}: ` +
      `${documents.map((d) => d.ref).join(", ")}; ` +
      `${errors.length} slot(s) reported (${reported.join(", ") || "none"}). ` +
      `Each body matched the held-out marker written only in its own file, and no ` +
      `document carried another's. A flow accepted the map as [${installed.join(", ")}] ` +
      `with each body intact. Nothing was registered and no model ran.`,
  };
});
