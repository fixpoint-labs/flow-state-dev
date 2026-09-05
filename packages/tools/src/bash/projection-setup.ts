/**
 * The wiring both bash entry points share.
 *
 * `createBashBlocks` and `createBashTool` are two doors onto one projection,
 * and they were two partial integrations of it: only one seeded the scratch
 * markers, only one reported what a flush decided, only one survived a failed
 * walk. Each gap was a bug in exactly the door that lacked it.
 *
 * So the wiring lives here once and both doors call it. What stays per-door is
 * what genuinely differs: the blocks path stamps application state on entries
 * through `createState`, and it holds a registry of live sandboxes.
 *
 * **Internal to the bash module.** Nothing here is re-exported from
 * `@flow-state-dev/tools/bash`, and it is not part of the package's public
 * API — these are `export`ed only so the two entry points in this directory
 * can share them. The public surface stays `createBashTool`,
 * `createBashBlocks` and `createBashCapability`.
 */
import path from "node:path";
import { createProjection, PlaceUnreadableError } from "@flow-state-dev/workspace";
import type {
  FlushOutcome,
  Mount as ProjectionMount,
  Place,
  Projection,
} from "@flow-state-dev/workspace";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";

/**
 * One collection mounted at a prefix, as the bash tool describes it.
 *
 * Deliberately the bash shape rather than the projection's: its collections
 * are `JsonObject`-stated because an application decides what a file entry
 * carries, while the projection wants the three fields it maintains itself.
 * The cast between them lives in `createMountedProjection` and nowhere else —
 * it used to be written out at both entry points.
 */
export interface BashMount {
  prefix: string;
  writable: boolean;
  collection: ResourceCollectionRef<JsonObject>;
  /** What the collection is durably — see `Mount.collectionId`. */
  collectionId: string;
}
import type { JsonObject } from "@flow-state-dev/core/types";
import { createSandboxPlace, KEEP_MARKER, TMP_DIR } from "./sandbox-place";
import type { Sandbox } from "./types";

/** Re-exported so both bash doors reach the scratch prefix through one module. */
export { TMP_DIR } from "./sandbox-place";

/**
 * Lay down the directory markers a walk needs to find.
 *
 * Two jobs. `./tmp/` really being there makes `ls` honest. And every mount
 * prefix existing is what keeps the walk from failing: on an exec-backed
 * sandbox the flush runs `find <destination>/<prefix>`, which exits non-zero
 * for a path that was never created — so an EMPTY collection would otherwise
 * make the first successful command fail during its flush. The place filters
 * these markers back out, so they never reach a collection.
 */
export async function seedWorkspaceMarkers(
  sandbox: Sandbox,
  destination: string,
  mounts: readonly BashMount[],
): Promise<void> {
  await sandbox.writeFile(path.join(destination, TMP_DIR, KEEP_MARKER), "");
  for (const mount of mounts) {
    await sandbox.writeFile(path.join(destination, mount.prefix, KEEP_MARKER), "");
  }
}

/**
 * A projection over a sandbox, with `createState` threaded onto every mount.
 *
 * `createState` has always been handed the workspace-relative path rather than
 * the collection key — the bash capability's default reads a title off its
 * basename — so it is rebuilt from the prefix here rather than passing the key.
 */
export function createBashProjection(
  sandbox: Sandbox,
  destination: string,
  mounts: readonly BashMount[],
  createState?: (relativePath: string) => Partial<JsonObject>,
): Projection {
  return createMountedProjection(createSandboxPlace(sandbox, destination), mounts, createState);
}

/**
 * The same projection over any place.
 *
 * The bind-mount write path supplies its own: the host directory it is already
 * writing to IS the place, so it can hydrate a real baseline instead of
 * carrying an empty one.
 */
export function createMountedProjection(
  place: Place,
  mounts: readonly BashMount[],
  createState?: (relativePath: string) => Partial<JsonObject>,
): Projection {
  return createProjection({
    place,
    mounts: mounts.map((m) => ({
      prefix: m.prefix,
      writable: m.writable,
      collectionId: m.collectionId,
      collection: m.collection as unknown as ProjectionMount["collection"],
      ...(createState === undefined
        ? {}
        : { entryState: (key: string) => createState(path.posix.join(m.prefix, key)) }),
    })),
  });
}

/**
 * Flush, and turn what it decided into diagnostics a developer can act on.
 *
 * Swallows exactly one failure: the walk. A walk that fails means the
 * projection refused to decide anything rather than reading an unreadable
 * workspace as an empty one — which is the whole point of it throwing — and a
 * flush that no-ops is recoverable where one that deletes is not.
 *
 * Everything else propagates. A collection read or write that fails is the
 * opposite case: the run's edits did not reach the store, and a command that
 * returned success while its files stayed only in the sandbox is a silent
 * loss. The old `createBashTool` sync path let those through; catching them
 * here alongside the walk would be a regression wearing a recovery's clothes.
 *
 * The projection is what tells them apart — it wraps a failed listing, and
 * only that, as `PlaceUnreadableError`.
 */
export async function flushWithDiagnostics(
  projection: Projection,
  mounts: readonly BashMount[],
  hostMountSource?: string,
): Promise<void> {
  let outcomes: readonly FlushOutcome[];
  try {
    outcomes = (await projection.flush()).outcomes;
  } catch (err) {
    if (!(err instanceof PlaceUnreadableError)) throw err;
    console.warn(`[bash] flush skipped — workspace walk failed: ${err.message}`);
    return;
  }
  warnUnsettled(outcomes);
  warnEmptyWalk(outcomes, mounts, hostMountSource);
}

/**
 * Warn about every outcome a caller cannot act on without being told.
 *
 * The clean ones are deliberately silent: a written file being where it should
 * be is not news, and saying so would make the interesting lines the ones you
 * have to filter for.
 */
/**
 * The sentence a model needs when its write did not reach the collection, or
 * `null` when it did.
 *
 * Both `writeFile` doors ask this, because both had the same hole: the
 * workspace write lands either way — the workspace is the run's own — and only
 * the durable half can be refused. Answering `{ success: true }` for a refusal
 * is how a model moves on believing an artifact was saved, and two doors
 * deciding that separately is how one of them keeps doing it.
 *
 * An orphan counts. It landed nowhere a collection owns, so by the contract
 * the caller now states — success means the file reached its collection — it
 * did not succeed. The first version of this excluded it on the grounds that
 * there is nothing to retry, which was wrong twice over: the model can retry
 * under a mounted prefix, and "nothing to retry" is not "it worked".
 */
export function refusalReason(outcome: FlushOutcome | undefined): string | null {
  if (outcome === undefined) return null;
  if (outcome.kind === "orphan") {
    return `"${outcome.path}" is not under any mounted collection or ./${TMP_DIR}/, so it was not saved.`;
  }
  if (outcome.kind === "conflict") {
    return `"${outcome.path}" changed in its collection while this run held it — the write was NOT applied.`;
  }
  if (outcome.kind === "contested") {
    return `"${outcome.path}" is being written by another run — the write was NOT applied.`;
  }
  if (outcome.kind === "readonly") {
    // Says "will not" where the others say "was not". The other refusals clear
    // once the other writer is done, so a model retrying them is doing the
    // right thing; this one never clears, and a model that keeps retrying it
    // burns the run.
    return `"${outcome.path}" is under "${outcome.prefix}/", which is read-only — the write was NOT saved, and retrying will not save it.`;
  }
  return null;
}

/**
 * Warn about the outcomes of a flush a caller cannot act on without being told.
 *
 * **No `readonly` branch:** only `put` produces one, and every door feeding this
 * mounts `writable: true`. Add it when one can mount something read-only.
 */
export function warnUnsettled(outcomes: readonly FlushOutcome[]): void {
  const orphans = outcomes.filter((o) => o.kind === "orphan").map((o) => o.path);
  if (orphans.length > 0) {
    console.warn(
      `[bash] dropped ${orphans.length} orphan file(s) not under any mounted collection (or ./${TMP_DIR}/): ${orphans.join(", ")}`,
    );
  }

  const conflicts = outcomes.filter(
    (o): o is Extract<FlushOutcome, { kind: "conflict" }> => o.kind === "conflict",
  );
  if (conflicts.length > 0) {
    console.warn(
      `[bash] ${conflicts.length} file(s) changed in their collection while this run held them, and were NOT overwritten: ${conflicts
        .map((c) => (c.ours === null ? `${c.path} (deleted here)` : c.path))
        .join(", ")}`,
    );
  }

  // Named separately from conflicts, because the fix is different. A conflict
  // is somebody who already wrote — you reconcile it. A contested path is
  // somebody writing right now, so the answer is usually to run the two runs
  // against different paths, and knowing WHICH path is what makes that
  // possible.
  const contested = outcomes.filter((o) => o.kind === "contested").map((o) => o.path);
  if (contested.length > 0) {
    console.warn(
      `[bash] ${contested.length} file(s) are being written by another run and were NOT overwritten: ${contested.join(", ")}`,
    );
  }
}

/**
 * A successful flush that reached zero files under writable mounts usually
 * means the run's writes landed somewhere the walk never visited.
 *
 * `outcomes.length > 0` carries weight: `every` is vacuously true on an empty
 * list, so without it this fires on every command in a session whose agent has
 * not written anything yet.
 */
function warnEmptyWalk(
  outcomes: readonly FlushOutcome[],
  mounts: readonly BashMount[],
  hostMountSource?: string,
): void {
  const writable = mounts.filter((m) => m.writable);
  if (writable.length === 0 || outcomes.length === 0) return;
  if (!outcomes.every((o) => o.kind === "orphan")) return;
  const source = hostMountSource ? ` (host walk under ${hostMountSource})` : "";
  console.warn(
    `[bash] flush walk found 0 files under writable mounts (${writable
      .map((m) => m.prefix)
      .join(", ")})${source}. If the agent just wrote a file, check that it landed under one of these prefixes.`,
  );
}
