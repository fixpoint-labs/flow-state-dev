/**
 * The team walk every workforce-tree reader shares.
 *
 * Workers come from `org/workers/` and `teams/<id>/workers/`, a worker's
 * skills from three `skills/` folders, and three readers held their own copy
 * of the walk down to a team folder, which had already drifted twice. That
 * walk is here, once. What a reader does *inside* a team is deliberately not:
 * that is where the conventions are supposed to differ.
 *
 * The primitives below it (`classify`, `openStructuralDirectory`, the refusal
 * wordings, `IGNORED_ENTRIES`) are the engine's (`@flow-state-dev/engine/folder`),
 * shared by every kit's folder reader.
 *
 * Node-only (`node:fs`), like every module behind the `./loader` subpath.
 */

import path from "node:path";
import {
  IGNORED_ENTRIES,
  classify,
  openStructuralDirectory,
  refusedSymlink,
  unreadable,
} from "@flow-state-dev/engine/folder";

/** One team folder a walk reached, handed to the reader that asked for it. */
export interface WalkedTeam {
  /** The folder's name, which is also the team half of every id minted under it. */
  id: string;
  /** Absolute path to the folder, for the reader to join its own slot onto. */
  dir: string;
  /** The folder's slash-separated path relative to the root — the prefix every report under it carries. */
  path: string;
}

/**
 * Walk `<root>/teams/` and yield every team folder a reader may descend into.
 *
 * The seam this package's readers share: they agree exactly down to the team
 * folder and diverge immediately after it, so this walk stops here. Which slot
 * a team holds, and what a thing inside that slot has to be, is the reader's own
 * and stays in the reader's own loop. The one exception is the resources walk
 * (`./resource-walk`), which continues from here into each team's workers on
 * behalf of both `resources/` doors, because those two agree further down.
 *
 * Yields only folders that can actually be descended into. A symlinked or
 * unreadable team is reported through `report` and skipped, because the things
 * beneath it cannot be enumerated to be named individually and silence there
 * would hide all of them at once. A team that is neither — a stray file, a
 * socket — occupies no team slot and is skipped without a report.
 *
 * An absent `teams/` yields nothing, silently: an app may declare no teams in
 * files. A `teams/` that is there and cannot be walked is reported under
 * `teams` and ends the walk, since nothing below it can be reached.
 *
 * @param report Files one failure, under its path relative to the root. Which
 *   of the reader's conditions that failure counts as belongs to the reader —
 *   this walk serves more than one, and their closed unions are not the same —
 *   so the tag is added by the caller rather than passed in here.
 *
 *   **Awaited before the walk moves on.** A reporter may be `async`: the walk
 *   is sequential either way, and failures are the rare path, so waiting costs
 *   nothing a caller would notice. What it buys is that a reporter which writes
 *   somewhere has finished by the time the walk ends, and one that rejects
 *   reaches the caller instead of becoming an unhandled rejection — which is
 *   what a `void` return would have produced, since TypeScript accepts an
 *   `async` function wherever a `void`-returning one is expected.
 */
export async function* walkTeams(
  root: string,
  report: (path: string, error: Error) => void | Promise<void>,
): AsyncGenerator<WalkedTeam> {
  const teams = await openStructuralDirectory(path.join(root, "teams"), "teams");
  if (teams.refusal !== undefined) {
    await report("teams", teams.refusal.error);
  }
  if (teams.entries === undefined) return;

  for (const id of teams.entries) {
    if (IGNORED_ENTRIES.has(id)) continue;

    const dir = path.join(root, "teams", id);
    const teamPath = `teams/${id}`;
    const team = await classify(dir);

    if (team.kind === "symlink") {
      await report(teamPath, refusedSymlink("team folder", id));
      continue;
    }
    if (team.kind === "unreadable") {
      await report(teamPath, unreadable("Team folder", id, team.error));
      continue;
    }
    if (team.kind !== "directory") continue;

    yield { id, dir, path: teamPath };
  }
}
