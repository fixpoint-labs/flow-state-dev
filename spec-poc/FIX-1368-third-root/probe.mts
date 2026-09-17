/**
 * FIX-1368 · characterization POC — what the shipped tree does with a third root today,
 * and what the per-seat install alternative costs.
 *
 * Throwaway. Lives only on `spec/FIX-1368`, never merges, never runs in CI.
 *
 *   pnpm tsx spec-poc/FIX-1368-third-root/probe.mts
 *
 * Four probes, each printing PASS/FAIL against an expectation written before it ran:
 *
 *   P1  `teams/<t>/workers/<w>/resources/<n>.md` produces no document AND no error.
 *       The silence class, not a reported gap.
 *   P2  The worker reader walks straight past that same folder — it only looks for WORKER.md.
 *   P3  Bare-name coexistence across org and team already works, through the ref shape alone.
 *   P4  The naive per-seat install (re-passing a kind's blueprint resource map as an
 *       instance map so a seat's own documents can be merged in) REFUSES TO MINT when the
 *       kind has a block-declared lazy resource — the instance map replaces the flow's own
 *       map, so a block-level declaration is promoted to flow level and rejected there.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineFlow, defineResource, handler } from "../../packages/core/src/index.ts";
import { z } from "zod";
import {
  readResourcesDirectory,
  readWorkforceDirectory,
} from "../../packages/workforce/src/loader/index.ts";

const DOC = `---
description: Recon's own runbook.
---

# Recon runbook
`;

const WORKER = `---
description: Recon seat.
---

Find things.
`;

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      got      ${a}\n      expected ${e}`);
}

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "fsd-1368-"));
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

// ── P1 · a worker-level document is neither read nor reported ────────────────
{
  const root = tree({
    "teams/pentest/workers/recon/WORKER.md": WORKER,
    "teams/pentest/workers/recon/resources/runbook.md": DOC,
    "teams/pentest/resources/handbook.md": DOC,
  });
  const res = await readResourcesDirectory(root);
  check("P1a documents", res.documents.map((d) => d.ref), ["teams/pentest/handbook"]);
  check("P1b errors", res.errors.map((e) => `${e.kind}:${e.path}`), []);
  rmSync(root, { recursive: true, force: true });
}

// ── P2 · the worker reader passes over the same folder ───────────────────────
{
  const root = tree({
    "teams/pentest/workers/recon/WORKER.md": WORKER,
    "teams/pentest/workers/recon/resources/runbook.md": DOC,
  });
  const res = await readWorkforceDirectory(root);
  check("P2a workers", res.workers.map((w) => w.id), ["pentest.recon"]);
  check("P2b errors", res.errors.map((e) => e.path), []);
  rmSync(root, { recursive: true, force: true });
}

// ── P3 · a bare name already coexists across the two shipped levels ──────────
{
  const root = tree({
    "org/resources/handbook.md": DOC,
    "teams/pentest/resources/handbook.md": DOC,
  });
  const res = await readResourcesDirectory(root);
  check("P3 refs", res.documents.map((d) => d.ref), ["handbook", "teams/pentest/handbook"]);
  rmSync(root, { recursive: true, force: true });
}

// ── P4 · what the per-seat install alternative costs ─────────────────────────
{
  const notes = defineResource({
    ref: "notes",
    scope: "org",
    stateSchema: z.object({}).passthrough(),
    default: {},
    prefetchMode: "lazy",
  });

  const readNotes = handler({
    name: "read-notes",
    requireOrg: true,
    resources: { notes },
    execute: async () => ({ ok: true }),
  });

  const kindFlow = defineFlow({ kind: "probe", actions: { go: { block: readNotes } } });

  // The blueprint's `resources` is the MERGED map (block + flow's own), while
  // `flowLevelResourceKeys` holds only the flow's own. A seat-install that re-passes the
  // merged map cannot tell them apart.
  check("P4a blueprint map", Object.keys(kindFlow.resources ?? {}), ["notes"]);
  check(
    "P4b flow-own keys",
    [...((kindFlow as unknown as { flowLevelResourceKeys: Set<string> }).flowLevelResourceKeys ?? [])],
    [],
  );

  let thrown: string | undefined;
  try {
    (kindFlow as unknown as (o: Record<string, unknown>) => unknown)({
      id: "probe.seat",
      resources: { ...(kindFlow.resources ?? {}) },
    });
  } catch (err) {
    thrown = (err as Error).message;
  }
  check("P4c mint refused", thrown !== undefined, true);
  console.log(`      message  ${thrown ?? "(none)"}`);
}

console.log(failures === 0 ? "\nAll probes matched." : `\n${failures} probe(s) did not match.`);
process.exit(failures === 0 ? 0 : 1);
