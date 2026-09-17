/**
 * Compile-time half of the worker reader's tag claim: every failure entry
 * carries a `kind`, and the tag is a closed union rather than a free string.
 *
 * The runtime tests in `read-workforce-directory.test.ts` pin which condition
 * each path reports. They cannot pin the part that matters to a caller writing
 * the `if`: that an entry without a `kind` no longer satisfies the type — which
 * is the whole reason the tag was added, since a flat untagged array is only
 * tellable apart by matching on `error.message` — and that a `kind` outside the
 * three conditions is rejected rather than silently admitted.
 *
 * Vitest strips types rather than checking them, and this package's `src`
 * typecheck does not include `test/`. So `tsconfig.test-d.json` compiles every
 * `.test-d.ts` file here, and the `typecheck` script runs it after the `src`
 * pass. Drop the tag back to an optional field and the `@ts-expect-error`
 * below has nothing to suppress, which is itself an error (TS2578) — so
 * `pnpm typecheck` goes red.
 *
 * Imported through the `./loader` barrel rather than the module, so the type a
 * caller is told to narrow on is also proven to be exported.
 */
import type { ReadWorkforceDirectoryResult, WorkerManifestError } from "../src/loader";

/** The result's own list is the tagged one — not a structurally similar neighbour. */
export const fromTheResult = (result: ReadWorkforceDirectoryResult): WorkerManifestError[] =>
  result.errors;

/** Every variant keys by `path`: the union never drops the `PathReport` contract. */
export const key = (entry: WorkerManifestError): string => entry.path;

/** Narrowing on `kind` tells a refused structural folder from a seat that would not load. */
export function lostEverythingBeneath(entry: WorkerManifestError): boolean {
  return entry.kind === "unreadable-slot";
}

/** Control — a structural refusal, the condition the shared walk reports through. */
export const slot: WorkerManifestError = {
  kind: "unreadable-slot",
  path: "teams/engineering",
  error: new Error("Symlinked team folder \"engineering\" — refused for safety"),
};

/** Control — the two conditions a worker slot itself can be in. */
export const loadFailed: WorkerManifestError = {
  kind: "worker-load-failed",
  path: "teams/engineering/workers/lead",
  error: new Error("Worker folder \"lead\" has no WORKER.md"),
};

export const refused: WorkerManifestError = {
  kind: "refused-declaration",
  path: "teams/engineering/workers/lead",
  error: new Error("WORKER.md in \"lead/\" declares an imposed key"),
};

// @ts-expect-error an untagged entry is not a WorkerManifestError — the point of S5.
export const untagged: WorkerManifestError = {
  path: "teams/engineering/workers/lead",
  error: new Error("no kind"),
};

/** The union is closed: a condition it does not have is not admitted. */
export const invented: WorkerManifestError = {
  // @ts-expect-error "worker-was-sleepy" is not one of the three conditions.
  kind: "worker-was-sleepy",
  path: "teams/engineering/workers/lead",
  error: new Error("not a condition"),
};
