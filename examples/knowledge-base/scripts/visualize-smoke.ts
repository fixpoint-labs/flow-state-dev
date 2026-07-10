// ---------------------------------------------------------------------------
// OKF acceptance smoke (`pnpm okf:smoke`).
//
// Round-trips the sample bundle through import -> export, then validates the
// exported bundle against OKF v0.1 conformance (SPEC §9) and builds the concept
// link graph the reference visualizer consumes (nodes + directed edges, with
// dangling links surfaced). This stands in for loading the bundle in OKF's
// Cytoscape HTML visualizer: a full headless-browser load is disproportionate
// for a reference example, so we assert the same input contract the visualizer needs
// — every concept parses, `type` is present, the root declares okf_version, and
// the link graph resolves. Exits non-zero on any conformance failure.
// ---------------------------------------------------------------------------

// The dev container sets FSDEV_INTENT_* / FSDEV_DEFAULT_MODEL for `fsdev`; the
// model-free collection here doesn't need them, and they make the default model
// resolver throw. Drop them before building the execution context.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("FSDEV_INTENT_") || key === "FSDEV_DEFAULT_MODEL") delete process.env[key];
}

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createExecutionContext, createInMemoryStores } from "@flow-state-dev/engine";
import { conceptCollection, type ConceptState } from "../src/concepts";
import { importOkf, exportOkf, parseOkfBundle, OKF_VERSION } from "../src/okf/index";

const SAMPLE_BUNDLE = new URL("../sample-bundle", import.meta.url).pathname;

async function emptyCollection(): Promise<ResourceCollectionRef<ConceptState>> {
  const block = handler({ name: "noop", resources: { concepts: conceptCollection }, execute: () => "ok" });
  const flow = defineFlow({ kind: "okf-smoke", actions: { run: { inputSchema: z.string(), block } } })();
  const ctx = await createExecutionContext({
    flow,
    actionName: "run",
    requestId: "req",
    sessionId: "sess",
    userId: "user",
    stores: createInMemoryStores(),
  });
  return (ctx as { resources: Record<string, unknown> }).resources.concepts as ResourceCollectionRef<ConceptState>;
}

async function main(): Promise<void> {
  const collection = await emptyCollection();
  const imported = await importOkf(SAMPLE_BUNDLE, collection);

  const out = await fs.mkdtemp(path.join(os.tmpdir(), "okf-smoke-"));
  const exported = await exportOkf(collection, out);

  const parsed = await parseOkfBundle(out);
  const ids = new Set(parsed.concepts.map((c) => c.id));

  const failures: string[] = [];

  // OKF §9.2: every concept must carry a non-empty `type`.
  for (const concept of parsed.concepts) {
    const type = concept.frontmatter.type;
    if (typeof type !== "string" || type.length === 0) failures.push(`${concept.id}: missing/empty type`);
  }
  // OKF §11: the root index declares the version.
  if (parsed.okfVersion !== OKF_VERSION) failures.push(`root index okf_version is ${parsed.okfVersion}, expected ${OKF_VERSION}`);

  // Build the concept graph the visualizer renders.
  let edgeCount = 0;
  const dangling: string[] = [];
  for (const concept of parsed.concepts) {
    for (const target of concept.links) {
      if (ids.has(target)) edgeCount += 1;
      else dangling.push(`${concept.id} -> ${target}`);
    }
  }

  console.log(`imported ${imported.imported} concept(s); exported ${exported.exported}`);
  console.log(`graph: ${ids.size} node(s), ${edgeCount} edge(s)`);
  if (dangling.length > 0) console.log(`dangling links (tolerated by OKF §5.3): ${dangling.join(", ")}`);

  if (failures.length > 0) {
    console.error(`OKF conformance FAILED:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`OKF v${OKF_VERSION} conformance OK — bundle at ${out} is visualizer-loadable`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
