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
import { createProjection } from "@flow-state-dev/workspace";
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
}
import type { JsonObject } from "@flow-state-dev/core/types";
import { createSandboxPlace, KEEP_MARKER } from "./sandbox-place";
import type { Sandbox } from "./types";

/** The scratch directory a run may write to without it reaching a collection. */
export const TMP_DIR = "tmp";

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
 * Never throws. A walk that fails means the projection refused to decide
 * anything rather than reading an unreadable workspace as an empty one — which
 * is the whole point of it throwing — and a flush that no-ops is recoverable
 * where one that deletes is not. Letting that reach the caller would fail an
 * otherwise successful command.
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
    console.warn(`[bash] flush skipped — workspace walk failed: ${(err as Error).message}`);
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
