/**
 * A hired team's `references/` document reaches the DevTool as read-only.
 *
 * The DevTool's Resources panel marks a resource read-only from the debug
 * snapshot's `writable: false`. The engine's own checks prove that mark for a
 * resource declared in flow config. This one proves the hire path feeds it: a
 * reference on disk, read by the real loader, installed on a kind and hired
 * with `hireWorkforce`, served through the real router, and read back from the
 * same debug route the panel reads. A `resources/` document on the same hire
 * is the control — it must not carry the mark.
 *
 * A seat only holds a document its kind declares, so the kind lives here and
 * declares both. Model-free: the seat's action is a plain handler, run only so
 * the session the snapshot is keyed by exists.
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { defineFlow, handler, type DeclaredResources } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
} from "@flow-state-dev/engine";
import { readDeclaredRoster } from "../src/loader/read-declared-roster";
import { referencesFromDocs } from "../src/references-from-docs";
import { resourcesFromDocs } from "../src/resources-from-docs";
import { hireWorkforce } from "../src/hire";
import { workerConfigSchema } from "../src/worker-config";

const KIND = "desk";
const SEAT = "engineering.ada";
const SESSION = "sess_devtool_seal";

/** The org handbook — `org/references/handbook.md`, sealed by the convention. */
const REFERENCE = "handbook";
/** The team scratchpad — `teams/engineering/resources/scratch.md`, mutable. */
const RESOURCE = "teams/engineering/scratch";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
});

async function tree(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devtool-seal-"));
  roots.push(root);
  const files: Record<string, string> = {
    "org/references/handbook.md": "---\ndescription: The org handbook\nllmReadable: true\n---\nORG HANDBOOK",
    "teams/engineering/resources/scratch.md":
      "---\ndescription: Engineering scratchpad\nllmReadable: true\nllmWritable: true\n---\nseed",
  };
  for (const [rel, body] of Object.entries(files)) {
    await fs.mkdir(path.join(root, path.dirname(rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), body, "utf8");
  }
  return root;
}

const work = handler({
  name: "desk-work",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async () => ({ ok: true }),
});

function kindWith(resources: DeclaredResources) {
  return defineFlow({
    kind: KIND,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    resources: { ...resources } as DeclaredResources,
    actions: { run: { inputSchema: z.object({}), block: work } },
  });
}

/**
 * The slice of the engine's `DebugResourceEntry` this reads. Local because the
 * engine does not export that type through any path this package depends on.
 */
type SnapshotEntry = { primaryName: string; aliases: string[]; writable?: boolean };

const SETTLE_POLLS = 200;

/**
 * Wait for the seat's run to finish, and throw unless it `completed`. A run
 * still in flight, or one that ended any other way (`failed`, `aborted`, …),
 * has not proved the seat was served, so the snapshot read must not go ahead
 * on it.
 */
async function completed(
  stores: ReturnType<typeof createInMemoryStores>,
  requestId: string,
): Promise<void> {
  let record = await stores.request.get(requestId);
  for (let i = 1; i < SETTLE_POLLS && (record === undefined || record.status === "in_progress"); i += 1) {
    await new Promise((r) => setTimeout(r, 10));
    record = await stores.request.get(requestId);
  }
  if (record === undefined || record.status === "in_progress") {
    throw new Error(
      `the seat's run did not settle within ${SETTLE_POLLS} polls; last status: ${record?.status ?? "no record"}`,
    );
  }
  if (record.status !== "completed") {
    throw new Error(`the seat's run ended "${record.status}", not "completed"`);
  }
}

/** Disk → loader → install → hire → router → one real action → the debug tree. */
async function devtoolResources(root: string): Promise<SnapshotEntry[]> {
  const roster = await readDeclaredRoster(root);
  expect(roster.problems).toEqual([]);
  const documents = resourcesFromDocs(roster.documents);
  const references = referencesFromDocs(roster.references);

  const [seat] = hireWorkforce(
    [{ id: SEAT, declared: { flow: KIND, description: SEAT }, body: "" }],
    { kinds: { [KIND]: kindWith({ ...documents, ...references }) as never }, documents, references },
  );

  const stores = createInMemoryStores();
  const registry = createFlowRegistry();
  registry.register(seat!);
  const router = createFlowApiRouter({ registry, stores, debugEndpointsEnabled: true });

  const run = await router.POST(
    new Request(`http://localhost/api/flows/${SEAT}/${SESSION}/actions/run`, {
      method: "POST",
      body: JSON.stringify({ userId: "user_1", input: {} }),
    }),
    { params: { path: [SEAT, SESSION, "actions", "run"] } },
  );
  expect(run.status).toBe(202);
  const { request } = (await run.json()) as { request: { id: string } };
  await completed(stores, request.id);

  const res = await router.GET(
    new Request(`http://localhost/api/flows/sessions/${SESSION}/debug/resources`),
    { params: { path: ["sessions", SESSION, "debug", "resources"] } },
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { resources: SnapshotEntry[] }).resources;
}

describe("the DevTool's read-only mark, on a hired seat", () => {
  it("marks the team's reference read-only and leaves its ordinary document writable", async () => {
    const entries = await devtoolResources(await tree());
    const reference = entries.find((e) => e.aliases.includes(REFERENCE));
    const resource = entries.find((e) => e.aliases.includes(RESOURCE));

    // Both present first. A missing entry has no `writable` either, and would
    // pass the resource's check below while proving nothing.
    expect(reference, `no snapshot entry for ${REFERENCE}`).toBeDefined();
    expect(resource, `no snapshot entry for ${RESOURCE}`).toBeDefined();

    expect(reference!.writable).toBe(false);
    // Absent and `true` both read as writable; only `false` puts the badge on.
    expect(resource!.writable).not.toBe(false);
  });
});
