/**
 * FIX-1481 · What the tree can say today — the spec's factual base, re-derived.
 *
 * Throwaway experiment retained as design evidence. Not production code, not a
 * workspace package, not in any default test/lint/knip discovery. Run it by
 * hand; see README.md.
 *
 * Every claim this spec rests on is a claim about what devtool *can* render,
 * and each one is checked here against the real module or the real handler
 * rather than against a reading of it. Four checks, each with a **control that
 * is run**: checks 1 and 2 plant something their assertion must reject, and
 * checks 2b and 3 — whose assertions are that a predicate says no and that a
 * door returns nothing — instead prove each can say the other thing when given
 * something it should accept. A green check nobody has seen fail is not
 * evidence (tenet 7).
 *
 * **What is deliberately NOT here: any assertion about the view.** Those would
 * describe today and go red the moment the feature they justify is built. They
 * are `file:line` cites in the README instead. See Check 1's header.
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
import { resourcesFromDocs } from "../../../../../packages/workforce/src/resources-from-docs";

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
// Check 1 — row 4. What a reason on the row will MEAN.
//
// Deliberately NOT a check on the view. An earlier version asserted the row's
// seven column headers and the absence of `feedback` in the rendering module,
// and both were wrong to retain: PR-A's whole job is to add a column and render
// that field, so the assertions were built to go red the moment the work
// succeeded. Those two facts are now `file:line` cites in the README, where a
// statement about today belongs.
//
// What survives is the half PR-A does not touch. `feedback` is written by task
// verbs, not by the view, so these hold before and after the render lands — and
// a fourth writer appearing later really would change what the column means.
// That is the lifecycle test FIX-817's V7 sets: a totality check earns
// retention when its expectation can be updated and still assert something.
// ---------------------------------------------------------------------------

/** Every task-collection verb body, sliced out by its `async <name>(` header. */
function verbBodies(source: string): { name: string; body: string }[] {
  return [...source.matchAll(/\n    async (\w+)\(/g)].map((m, i, all) => ({
    name: m[1],
    body: source.slice(m.index!, all[i + 1]?.index ?? source.length)
  }));
}

/** Which verbs write `feedback`, sorted. */
function feedbackWriters(source: string): string[] {
  return verbBodies(source)
    .filter((v) => /feedback:|\{ feedback \}/.test(v.body))
    .map((v) => v.name)
    .sort();
}

function check1(): void {
  console.log("\nCheck 1 · row 4 · what a reason on the row will mean");

  const tasks = readFileSync(
    resolve(REPO, "packages/orchestration/src/tasks/collection/resource-backed.ts"),
    "utf8"
  );

  // TOTALITY over the writers, not a spot check: every verb that writes the
  // field, named. Three today — `fail` (the retry patch, which leaves it on a
  // row back at `pending`), `awaitReview` (the park) and `unpark` (which clears
  // it unless given a new one). A spot check for "awaitReview writes it" would
  // pass while a fourth writer quietly broadened what the column reports.
  const writers = feedbackWriters(tasks);
  expect(
    "exactly three task verbs write `feedback`, and they are the known three",
    JSON.stringify(writers) === JSON.stringify(["awaitReview", "fail", "unpark"]),
    `writers are ${JSON.stringify(writers)} — the column's meaning per status needs re-deriving`
  );

  // BR-3's subject, asserted as TODAY's behaviour on purpose: the filed
  // follow-up that fixes it should make this assertion go red, which is how a
  // check earns the right to describe a defect.
  expect(
    "a park with no feedback does not clear a previous one",
    /async awaitReview\(id, feedback, options\) \{[\s\S]{0,400}?feedback !== undefined \? \{ feedback \} : \{\}/.test(
      tasks
    ),
    "awaitReview no longer leaves a stale feedback in place — re-check BR-3"
  );

  // NEGATIVE CONTROL, run. Plant a fourth writer and watch the totality
  // assertion reject it. Without this, a verb regex that silently matched
  // nothing would "pass" by returning an empty list.
  const planted = tasks.replace(
    "    async awaitReview(",
    "    async settle(id, feedback, options) {\n      return { feedback: feedback };\n    },\n\n    async awaitReview("
  );
  const plantedWriters = feedbackWriters(planted);
  expect(
    "negative control · a planted fourth writer is rejected",
    plantedWriters.length === 4 && plantedWriters.includes("settle"),
    `the planted writer was absorbed: ${JSON.stringify(plantedWriters)}`
  );
}

// ---------------------------------------------------------------------------
// Check 2 — row 6. A sealed document and a mutable one come back from the real
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
  console.log("\nCheck 2 · row 6 · read-only is unrenderable: sealed and mutable are one row");

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
// Check 2b — row 6. WHICH predicate the mark is allowed to be.
//
// D1 marks on `writable === false` and explicitly not on the agent manifest's
// `mayWrite`. That rejection is not a preference, and this is the run that
// settles it: `llmWritable` is opt-in, so `!mayWrite` is true for almost
// everything — including the mutable `resources/` document row 6 exists to
// distinguish from a sealed reference.
// ---------------------------------------------------------------------------

/** `contractOf`'s predicate, copied from `core/src/manifest/resources-source.ts:50`. */
const mayWrite = (cfg: any) => cfg?.llmWritable === true && cfg?.writable !== false;

/** D1's predicate: the condition the engine refuses a write on. */
const sealed = (cfg: any) => cfg?.writable === false;

function check2b(): void {
  console.log("\nCheck 2b · row 6 · the mark is the seal, not the agent's write gate");

  const reference = (referencesFromDocs([REF_DOC as never]) as Record<string, any>).handbook;
  const mutableDoc = (
    resourcesFromDocs([
      { ref: "scratchpad", filePath: REF_DOC.filePath, declared: {}, body: "x" } as never
    ]) as Record<string, any>
  ).scratchpad;

  // The two halves of the FIX-1467 split, minted by their real conventions.
  expect(
    "the seal separates them: the reference is marked, the mutable document is not",
    sealed(reference) && !sealed(mutableDoc),
    `reference sealed=${sealed(reference)}, mutable sealed=${sealed(mutableDoc)}`
  );

  // THE REJECTION, run rather than argued. If this ever stops holding, the
  // reasoning in D1's "considered and dropped" row has changed and the
  // alternative deserves re-reading.
  expect(
    "`!mayWrite` would mark BOTH — which is why D1 does not use it",
    !mayWrite(reference) && !mayWrite(mutableDoc),
    "the mutable document now satisfies mayWrite; re-read D1's rejected alternative"
  );

  // POSITIVE CONTROL: `sealed` must be capable of saying "no" for a reason
  // other than the field being missing, and "yes" for one that opts in.
  expect(
    "positive control · sealed() tracks the field rather than always answering no",
    sealed({ writable: false, llmWritable: true }) && !sealed({ writable: true }),
    "sealed() is not reading `writable`"
  );
}

// ---------------------------------------------------------------------------
// Check 3 — row 5. The non-debug door cannot see these resources at all, and
// the reference app writes no inventory for it to see.
// ---------------------------------------------------------------------------

async function check3(): Promise<void> {
  console.log("\nCheck 3 · row 5 · the non-debug door, and what it would have to show");

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
  check2b();
  await check3();
  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
