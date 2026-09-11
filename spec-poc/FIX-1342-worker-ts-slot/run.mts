/**
 * FIX-1342 — what happens to an app whose worker folder holds a `worker.ts`?
 *
 * Throwaway. Never merges. Builds a workforce tree with one ordinary document
 * worker and one folder holding only a code file, reads it with the real
 * loader, and then applies the startup guard the docs tell every app to write
 * (`apps/docs/docs/orchestration/workers-on-disk.md` → "Treat a non-empty
 * `errors` as fatal", repeated in `packages/workforce/README.md`).
 *
 * The point is the composition: each half is already checked in, and what the
 * two do together is what the author actually experiences.
 *
 *     pnpm tsx spec-poc/FIX-1342-worker-ts-slot/run.mts
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readWorkforceDirectory } from "../../packages/workforce/src/loader/read-workforce-directory";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "fix-1342-"));
const workers = path.join(root, "teams/engineering/workers");

// An ordinary seat: a document.
await fs.mkdir(path.join(workers, "lead"), { recursive: true });
await fs.writeFile(
  path.join(workers, "lead/WORKER.md"),
  "---\ndescription: Holds the engineering board.\nflow: worker-agent\n---\nYou lead.\n",
);

// A worker slot holding only code — the folder this issue is about.
await fs.mkdir(path.join(workers, "router"), { recursive: true });
await fs.writeFile(
  path.join(workers, "router/worker.ts"),
  "export const routerFlow = {};\n",
);

const { workers: loaded, errors } = await readWorkforceDirectory(root);

console.log("loaded:", loaded.map((w) => w.id));
console.log("reported:", errors.map((e) => `${e.path}: ${e.error.message}`));

// Verbatim from the documented startup guard.
let refusal: string | undefined;
try {
  if (errors.length) {
    throw new Error(
      `workforce: ${errors.length} worker(s) failed to load\n` +
        errors.map(({ path: p, error }) => `  ${p}: ${error.message}`).join("\n"),
    );
  }
} catch (error) {
  refusal = (error as Error).message;
}

// Graded, not printed-and-hoped: the healthy worker loaded, the code folder was
// reported under its own path, and the documented guard turned that into a
// failed boot whose message names no route the author can take.
assert.deepEqual(loaded.map((w) => w.id), ["engineering.lead"]);
assert.equal(errors.length, 1);
assert.equal(errors[0]!.path, "teams/engineering/workers/router");
assert.ok(refusal, "expected the documented startup guard to refuse the boot");
assert.match(refusal, /has no WORKER\.md/);
assert.doesNotMatch(
  refusal,
  /kind|flow factory|hireWorkforce/i,
  "the refusal names no route — that silence is the issue",
);

console.log("\nthe app refused to boot:\n" + refusal);
console.log("\nPASS — the folder is reported, the boot fails, and the message names no route.");

await fs.rm(root, { recursive: true, force: true });
