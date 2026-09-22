/**
 * FIX-1481 · What the tree can say today — the spec's factual base, re-derived.
 *
 * Throwaway experiment retained as design evidence. Not production code, not a
 * workspace package, not in any default test/lint/knip discovery. Run it by
 * hand; see README.md.
 *
 * Every claim this spec rests on is a claim about what devtool *can* render,
 * and each one is checked here against the real module or the real handler
 * rather than against a reading of it. Three checks, each with a **negative
 * control** that is run and must go red before the real assertion is trusted
 * (tenet 7 — a green check nobody has seen fail is not evidence).
 *
 * The imports reach into `src/` rather than package entry points on purpose:
 * `referencesFromDocs` and `resolveSeatResources` are internal to
 * `@flow-state-dev/workforce`, and pretending otherwise would teach the wrong
 * boundary. That is a limit of the experiment, recorded in the README.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { defineFlow, defineResource, handler } from "../../../../../packages/core/src/index";
import { createFlowRegistry, createInMemoryStores } from "../../../../../packages/engine/src/index";
import {
  handleDebugListResources,
  resolveDebugConfig
} from "../../../../../packages/engine/src/routes/debug-routes";
import { handleGetResourceManifest } from "../../../../../packages/engine/src/routes/resource-routes";
import { referencesFromDocs } from "../../../../../packages/workforce/src/references-from-docs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

let failures = 0;
const ok = (name: string) => console.log(`  PASS  ${name}`);
const bad = (name: string, detail: string) => {
  failures += 1;
  console.log(`  FAIL  ${name}\n        ${detail}`);
};
const expect = (name: string, cond: boolean, detail: string) =>
  cond ? ok(name) : bad(name, detail);

// ---------------------------------------------------------------------------
// Check 1 — row 1. The parked reason is already in devtool's model, and is on
// no column of the row.
// ---------------------------------------------------------------------------

/** Every `<th>` label in a source, in document order. */
function columnHeaders(source: string): string[] {
  return [...source.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1].trim());
}

function check1(): void {
  console.log("\nCheck 1 · the parked reason: in the model, not on the row");

  const viewPath = "packages/devtool/src/react/components/workspace/task-collections-view.tsx";
  const statePath = "packages/devtool/src/react/lib/task-collection-state.ts";
  const view = readFileSync(resolve(REPO, viewPath), "utf8");
  const state = readFileSync(resolve(REPO, statePath), "utf8");

  // TOTALITY, not a spot check: the assertion is over the WHOLE header set, so
  // a column added since this was written fails the check instead of hiding in
  // it. A spot check for "no Reason column" would pass on a row that had
  // silently gained three other columns.
  const expected = ["Id", "Goal", "Status", "Assignee", "ChildSession", "Latest kind", "Details"];
  const found = columnHeaders(view);
  expect(
    "the task row's columns are exactly the seven known ones",
    JSON.stringify(found) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, found ${JSON.stringify(found)}`
  );

  expect(
    "the rendering module never mentions `feedback`",
    !/feedback/i.test(view),
    "a `feedback` reference appeared in task-collections-view.tsx"
  );

  // The other half, and the one that sizes the work: the field is ALREADY in
  // devtool's wire-shape mirror of `Task`. Nothing has to reach the browser
  // that is not there; row 1 is a render, not a wire change.
  expect(
    "devtool's `Task` mirror already declares `feedback`",
    /^\s*feedback\?: string;/m.test(state),
    "no `feedback?: string` in task-collection-state.ts — row 1 would need a wire change"
  );

  // `feedback` is NOT parked-only, and the column's meaning depends on that.
  // TOTALITY over the writers: every site in the task collection that writes
  // the field, with the status it lands on. Three today — a park, a retry, and
  // an unpark that clears it. A fourth appearing silently would change what a
  // "Reason" column means, so the count is asserted rather than sampled.
  const tasks = readFileSync(
    resolve(REPO, "packages/orchestration/src/tasks/collection/resource-backed.ts"),
    "utf8"
  );
  // Slice the collection into its verb bodies and ask which ones write the
  // field. Three today: `fail` (the retry patch), `awaitReview` (the park) and
  // `unpark` (which clears it unless given a new one).
  const verbs = [...tasks.matchAll(/\n    async (\w+)\(/g)].map((m, i, all) => ({
    name: m[1],
    body: tasks.slice(m.index!, all[i + 1]?.index ?? tasks.length)
  }));
  const writers = verbs
    .filter((v) => /feedback:|\{ feedback \}/.test(v.body))
    .map((v) => v.name)
    .sort();
  expect(
    "exactly three task verbs write `feedback`, and they are the known three",
    JSON.stringify(writers) === JSON.stringify(["awaitReview", "fail", "unpark"]),
    `writers are ${JSON.stringify(writers)} — the column's meaning per status needs re-deriving`
  );

  expect(
    "a park with no feedback does not clear a previous one",
    /async awaitReview\(id, feedback, options\) \{[\s\S]{0,400}?feedback !== undefined \? \{ feedback \} : \{\}/.test(
      tasks
    ),
    "awaitReview no longer leaves a stale feedback in place — re-check BR-3"
  );

  // NEGATIVE CONTROL, run. Plant an eighth column and watch the totality
  // assertion reject it. Without this, a header regex that silently matched
  // nothing would "pass" both assertions above.
  const planted = view.replace(
    '<th className="py-1.5 font-medium">Goal</th>',
    '<th className="py-1.5 font-medium">Goal</th><th>Reason</th>'
  );
  const plantedFound = columnHeaders(planted);
  expect(
    "negative control · a planted eighth column is rejected",
    JSON.stringify(plantedFound) !== JSON.stringify(expected) && plantedFound.length === 8,
    `the planted column was absorbed: ${JSON.stringify(plantedFound)}`
  );
}

// ---------------------------------------------------------------------------
// Check 2 — row 2. A sealed document and a mutable one come back from the real
// debug snapshot field for field identical.
// ---------------------------------------------------------------------------

const REF_DOC = {
  ref: "handbook",
  filePath: resolve(REPO, "README.md"),
  declared: {} as Record<string, unknown>
};

/** The `ro`-grant seal, exactly as `seat-resources.ts:529` mints it. */
function sealedByGrant(entry: object): object {
  return { ...entry, writable: false, llmWritable: false };
}

function buildFlow(extra: Record<string, unknown> = {}) {
  const mutable = defineResource({
    scope: "org",
    stateSchema: z.object({ note: z.string().default("") }),
    default: {}
  });

  const references = referencesFromDocs([REF_DOC as never]) as Record<string, unknown>;

  // Resources are declared on the block; `flow.resources` is the flattened map
  // the debug snapshot and the manifest both walk.
  const block = handler({
    name: "noop",
    resources: {
      // The two producers of the seal, and one mutable neighbour.
      sealedByReference: references.handbook,
      sealedByGrant: sealedByGrant(mutable as object),
      mutable,
      ...extra
    },
    execute: () => "ok"
  } as never);

  return defineFlow({
    kind: "poc-flow",
    actions: { run: { inputSchema: z.string(), block } }
  } as never)();
}

async function snapshotEntries(flow: unknown) {
  const stores = createInMemoryStores();
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const sessionId = "poc_sess";
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind: "poc-flow",
      userId: "poc_user",
      state: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    } as never,
    "any"
  );
  const ctx = {
    registry,
    stores,
    debug: resolveDebugConfig({ debugEndpointsEnabled: true })
  };
  const res = await handleDebugListResources(
    new Request("http://localhost/api/flows/sessions/poc_sess/debug/resources"),
    { kind: "debug_list_resources", sessionId },
    ctx as never
  );
  if (res.status !== 200) {
    throw new Error(`debug snapshot returned ${res.status}: ${await res.text()}`);
  }
  return { ctx, sessionId, body: (await res.json()) as { resources: Record<string, unknown>[] } };
}

/** An entry with its identity stripped — what is left is what the tree can say. */
function withoutIdentity(entry: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...entry };
  for (const k of ["definitionId", "primaryName", "aliases", "storagePrefix", "state", "clientView"]) {
    delete copy[k];
  }
  return copy;
}

async function check2(): Promise<void> {
  console.log("\nCheck 2 · read-only is unrenderable: sealed and mutable are the same row");

  const { body } = await snapshotEntries(buildFlow());
  const byName = new Map(body.resources.map((e) => [e.primaryName as string, e]));
  // `POC_DUMP=1` prints the three entries verbatim — what the tree has to work with.
  if (process.env.POC_DUMP) console.log(JSON.stringify(body.resources, null, 2));

  expect(
    "all three resources reach the debug tree",
    ["sealedByReference", "sealedByGrant", "mutable"].every((n) => byName.has(n)),
    `tree returned ${[...byName.keys()].join(", ")}`
  );

  // TOTALITY over the field set: no key of any entry is about writability. A
  // check for "no `writable` key" alone would miss `llmWritable`, `readOnly`,
  // `sealed` or anything else a future field might be called.
  const everyKey = new Set(body.resources.flatMap((e) => Object.keys(e)));
  expect(
    "no field of any entry speaks about writability",
    ![...everyKey].some((k) => /writ|readonly|sealed|mutab/i.test(k)),
    `writability-ish keys present: ${[...everyKey].filter((k) => /writ|readonly|sealed|mutab/i.test(k)).join(", ")}`
  );

  const sealedRef = withoutIdentity(byName.get("sealedByReference")!);
  const sealedGrant = withoutIdentity(byName.get("sealedByGrant")!);
  const mutable = withoutIdentity(byName.get("mutable")!);

  expect(
    "a grant-sealed document is indistinguishable from the mutable one",
    JSON.stringify(sealedGrant) === JSON.stringify(mutable),
    `grant-sealed ${JSON.stringify(sealedGrant)} vs mutable ${JSON.stringify(mutable)}`
  );

  // Stronger than expected, and worth stating plainly: the reference does not
  // differ from the mutable resource in ANY non-identity field. Even its
  // file-backed content is invisible here (`hasContent: false` — the field
  // reports persisted content, which a file-backed reference has none of).
  const refDelta = Object.keys({ ...sealedRef, ...mutable }).filter(
    (k) => JSON.stringify(sealedRef[k]) !== JSON.stringify(mutable[k])
  );
  expect(
    "a reference is identical to the mutable resource in every non-identity field",
    refDelta.length === 0,
    `differing fields: ${refDelta.join(", ")}`
  );

  // NEGATIVE CONTROL, run. Give one entry a `writable` field and watch both
  // the totality assertion and the equality assertion go red.
  const planted = body.resources.map((e) =>
    e.primaryName === "mutable" ? { ...e, writable: true } : e
  );
  const plantedKeys = new Set(planted.flatMap((e) => Object.keys(e)));
  const plantedMutable = withoutIdentity(planted.find((e) => e.primaryName === "mutable")!);
  expect(
    "negative control · a planted `writable` field is caught",
    [...plantedKeys].some((k) => /writ/i.test(k)) &&
      JSON.stringify(plantedMutable) !== JSON.stringify(sealedGrant),
    "the planted writability field was absorbed by both assertions"
  );
}

// ---------------------------------------------------------------------------
// Check 3 — row 3. The non-debug door cannot see these resources at all, and
// the reference app writes no inventory for it to see.
// ---------------------------------------------------------------------------

async function check3(): Promise<void> {
  console.log("\nCheck 3 · the non-debug door, and what it would have to show");

  const flow = buildFlow();
  const { ctx, sessionId } = await snapshotEntries(flow);
  const res = await handleGetResourceManifest(
    new Request("http://localhost/api/flows/sessions/poc_sess/manifest"),
    { kind: "get_resource_manifest", sessionId },
    ctx as never
  );
  const body = (await res.json()) as { resources: unknown[] };
  expect(
    "the non-debug manifest shows none of them — no `client` config, no entry",
    res.status === 200 && body.resources.length === 0,
    `status ${res.status}, ${body.resources.length} entries: ${JSON.stringify(body.resources)}`
  );

  // POSITIVE CONTROL: the check must reach the code it covers. A resource that
  // DOES declare a client surface has to come back, or "zero entries" is just
  // a broken call.
  const visible = defineResource({
    scope: "org",
    stateSchema: z.object({ v: z.string().default("") }),
    default: {},
    client: { state: { read: true }, expose: ["v"] }
  } as never);
  const withVisible = buildFlow({ visible });
  const second = await snapshotEntries(withVisible);
  const res2 = await handleGetResourceManifest(
    new Request("http://localhost/api/flows/sessions/poc_sess/manifest"),
    { kind: "get_resource_manifest", sessionId: second.sessionId },
    second.ctx as never
  );
  const body2 = (await res2.json()) as { resources: { ref: string }[] };
  expect(
    "positive control · a client-visible resource does come back",
    body2.resources.length === 1 && body2.resources[0]?.ref === "visible",
    `expected one entry named "visible", got ${JSON.stringify(body2.resources)}`
  );

  // And the subject itself: nothing in any app opens the live inventory, so
  // there are no inventory rows for any door to serve.
  const callSites = execFileSync(
    "git",
    ["grep", "-l", "openInventory(", "--", "apps"],
    { cwd: REPO, encoding: "utf8" }
  ).trim();
  const nonDocs = callSites
    .split("\n")
    .filter((f) => f !== "" && !f.startsWith("apps/docs/"));
  expect(
    "no app calls `openInventory`, so the reference app has no inventory rows",
    nonDocs.length === 0,
    `call sites found: ${nonDocs.join(", ")}`
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("FIX-1481 · what the tree can say today");
  check1();
  await check2();
  await check3();
  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
