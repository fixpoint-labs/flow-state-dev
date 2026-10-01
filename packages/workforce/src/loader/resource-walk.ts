/**
 * Where a `resources/` folder may sit — the one walk both resources doors ride,
 * and the list of places beside it.
 *
 * Two doors read the same folders: the Markdown reader
 * (`./read-resources-directory`, for `resources/` and `references/`) and the
 * TypeScript module walk (`../codegen/discover-resource-modules`). They are
 * separate readers on purpose — one reader holding two conventions is the
 * mega-loader the shared walk primitives exist to prevent — but they must not
 * disagree about **where they look**. Each used to carry its own copy of the
 * descent through `org/`, its workers, the teams and theirs; this module is the
 * one copy, and both doors iterate what it yields.
 *
 * **It yields places, not slot folders.** A place is a folder that may hold the
 * convention's slots, with what a door needs to read one there: its path, its
 * team and worker, whether it is a worker's own, the ref rule for a file in it,
 * and the pattern it appears under in {@link RESOURCE_SLOT_PATTERNS}. What a
 * door does inside the folder — which slot it opens, what a file there is, how
 * it reports — stays the door's. The walk knows nothing about files.
 *
 * **Refusals are yielded as facts, not reported in a wording.** A structural
 * refusal (`org/`, a `workers/` level, a team) already carries the shared
 * wording, and both doors file it as it comes. A refused worker folder is the
 * one place the doors name a thing differently — the Markdown door by the
 * folder's name, the module walk by its full path — so that event hands over
 * a builder that takes the name to put in the shared wording.
 *
 * **The list and the walk are two representations in one file.** The walk
 * finds folders by walking; the list is what `fsdev gen` prints and what the
 * both-doors test builds its tree from. They cannot be one thing without
 * driving the walk from data, which per-level wording and `org/`'s structural
 * open do not fit. What keeps them in step is that every yielded place carries
 * its pattern, and the tests check the yields against the list both ways. A new
 * place is a visit here and an entry on the list, in this one file.
 *
 * Not exported from `./index`: it is the doors' shared internals, not a
 * convention API. Node-only (`node:fs`, via the structural primitives).
 */

import path from "node:path";
import { RESOURCES_SLOT, WORKERS_LEVEL, mintResourceRef } from "./resource-convention";
import {
  IGNORED_ENTRIES,
  classify,
  openRoot,
  openStructuralDirectory,
  refusedSymlink,
  unreadable,
  walkTeams,
} from "./structural-directory";

const ORG_PLACE = `org/${RESOURCES_SLOT}`;
const ORG_WORKER_PLACE = `org/${WORKERS_LEVEL}/*/${RESOURCES_SLOT}`;
const TEAM_PLACE = `teams/*/${RESOURCES_SLOT}`;
const TEAM_WORKER_PLACE = `teams/*/${WORKERS_LEVEL}/*/${RESOURCES_SLOT}`;

/**
 * The four places a `resources/` slot can be, as `fsdev gen` reports them and
 * in the order the walk visits them.
 *
 * Patterns rather than the concrete folders walked: the concrete list is one
 * line per seat in the tree, and what an author wants to read back is where the
 * convention looks. Frozen, and never joined onto a path by a door — the walk
 * finds its folders by walking, not by expanding these. Each entry is the
 * {@link ResourcePlace.pattern} of the places the walk yields there, which is
 * how the tests hold the two in step.
 */
export const RESOURCE_SLOT_PATTERNS: readonly string[] = Object.freeze([
  ORG_PLACE,
  ORG_WORKER_PLACE,
  TEAM_PLACE,
  TEAM_WORKER_PLACE,
]);

/** One folder where the convention's slots may sit. */
export interface ResourcePlace {
  type: "place";
  /** The folder, absolute. A door joins its slot name onto it. */
  dir: string;
  /** The folder, slash-separated and relative to the root — `org`, `teams/eng/workers/lead`. */
  path: string;
  /** Which {@link RESOURCE_SLOT_PATTERNS} entry this place is an instance of. */
  pattern: string;
  /** Whether this is one worker's own folder, rather than the organisation's or a team's. */
  atWorkerRoot: boolean;
  /** Mint the ref for a file of this basename in a slot here. Throws on a bad segment. */
  mintRef: (name: string) => string;
}

/** A structural folder on the way to a place that the walk will not go through. */
export interface ResourceWalkRefusal {
  type: "refused";
  /** The refused folder, relative to the root. */
  path: string;
  /** The shared wording, naming the folder as the structural primitives do. */
  error: Error;
}

/**
 * A worker folder the walk will not go through — symlinked, or there and
 * unreadable. Its own event because it is the one refusal the two doors word
 * differently (E2): each names the folder its own way, through {@link refusal}.
 */
export interface ResourceWalkWorkerRefusal {
  type: "worker-refused";
  /** The worker folder, relative to the root — `teams/eng/workers/scout`. */
  path: string;
  /** The folder's own name — `scout`. */
  workerName: string;
  /** The shared wording for this refusal, naming the folder as `named`. */
  refusal: (named: string) => Error;
}

/** What {@link walkResourcePlaces} yields, in walk order. */
export type ResourceWalkStep = ResourcePlace | ResourceWalkRefusal | ResourceWalkWorkerRefusal;

/** The one thing a door decides about the descent. */
export interface ResourceWalkOptions {
  /**
   * The order a `workers/` level's entries are visited in. The Markdown door
   * keeps the directory's order; the module walk sorts, so `fsdev gen` reports
   * the same way on every machine. Unifying them would change one door's
   * output, so the door says.
   */
  workerOrder: (entries: string[]) => string[];
}

/**
 * Walk every place a `resources/` slot can be: the organisation's folder, then
 * each org worker's, then for each team its own folder and each of its workers'.
 *
 * Opens the root first and throws when it is refused — a symlinked, missing or
 * collapsing root is a wiring mistake, not a per-place one. Everything else is
 * yielded: a place to read, or a refusal to file.
 */
export async function* walkResourcePlaces(
  root: string,
  options: ResourceWalkOptions,
): AsyncGenerator<ResourceWalkStep> {
  await openRoot(root);

  // The org root. Opened structurally rather than merely classified, so a
  // symlinked or unreadable `org/` is reported the way `teams/` is. Absence is
  // silent: an app may declare nothing at the organisation level. It stays in
  // this walk rather than in `walkTeams`, which the channels reader also rides
  // and which must not hand it an `org/` scope it is not allowed to use.
  const orgDir = path.join(root, "org");
  const org = await openStructuralDirectory(orgDir, "org");
  if (org.refusal !== undefined) {
    yield { type: "refused", path: "org", error: org.refusal.error };
  }
  if (org.entries !== undefined) {
    yield {
      type: "place",
      dir: orgDir,
      path: "org",
      pattern: ORG_PLACE,
      atWorkerRoot: false,
      mintRef: (name) => mintResourceRef(undefined, undefined, name),
    };
    // Org workers are rare shared-infra seats, and their files load for the
    // reason a team worker's do. Their ref drops `org/`, exactly as an org
    // file's does. No seat can be hired at that address yet — the roster reader
    // passes over `org/workers/` in silence and a worker id requires a team —
    // which is a larger gap than this walk closes, and not a reason for the
    // files to go on being unread.
    yield* walkWorkers(orgDir, "org", undefined, ORG_WORKER_PLACE, options);
  }

  // `walkTeams` reports through a callback, and a generator cannot yield from
  // one. Its reporter is awaited before the walk moves on, so every refusal it
  // files is buffered by the time the next team is handed over, and flushing
  // before each team keeps the order a reporter would have seen.
  const pending: ResourceWalkRefusal[] = [];
  for await (const team of walkTeams(root, (at, error) => {
    pending.push({ type: "refused", path: at, error });
  })) {
    yield* pending.splice(0);
    yield {
      type: "place",
      dir: team.dir,
      path: team.path,
      pattern: TEAM_PLACE,
      atWorkerRoot: false,
      mintRef: (name) => mintResourceRef(team.id, undefined, name),
    };
    yield* walkWorkers(team.dir, team.path, team.id, TEAM_WORKER_PLACE, options);
  }
  yield* pending.splice(0);
}

/**
 * Yield every worker's folder under one parent — `org/` or a team folder.
 *
 * One function called twice rather than two copies: the two parents differ only
 * in the team id handed to the ref minter, and a second copy is how the levels
 * of a tree start disagreeing about what a symlink means.
 *
 * This level is the worker reader's rule: a `workers/` level holds folders, so a
 * *file* in it occupies no slot and is passed over in silence. Inside a worker's
 * slot the rule is the door's again.
 *
 * What it does NOT do is open `WORKER.md`. Whether a folder describes a seat is
 * the roster reader's question, answered and reported separately; the doors are
 * answering a question about a file.
 */
async function* walkWorkers(
  parentDir: string,
  parentPath: string,
  teamId: string | undefined,
  pattern: string,
  options: ResourceWalkOptions,
): AsyncGenerator<ResourceWalkStep> {
  const workersPath = `${parentPath}/${WORKERS_LEVEL}`;
  const workers = await openStructuralDirectory(path.join(parentDir, WORKERS_LEVEL), workersPath);
  if (workers.refusal !== undefined) {
    yield { type: "refused", path: workersPath, error: workers.refusal.error };
  }
  if (workers.entries === undefined) return;

  for (const workerName of options.workerOrder(workers.entries)) {
    if (IGNORED_ENTRIES.has(workerName)) continue;

    // No name is special at this level — including `resources`. A folder here
    // is judged by the slot it occupies, not by what it looks like, which is
    // the rule the other readers already apply: `readWorkforceDirectory` hires
    // `teams/<t>/workers/resources/` off its `WORKER.md`, and `readSeatSkills`
    // reads that seat's own `skills/`. Skipping the name here would leave
    // exactly one seat in the tree whose files are read by nothing and reported
    // by nothing — the silent drop this convention exists to remove,
    // reintroduced one level down.
    //
    // It would also buy nothing. The author who writes a document one level too
    // high, at `workers/resources/stray.md`, is not rescued by a skip: that file
    // sits beside a `resources/` slot rather than in one, so the walk passes it
    // over either way. What the skip cost was a real seat's files.
    const workerDir = path.join(parentDir, WORKERS_LEVEL, workerName);
    const entryPath = `${workersPath}/${workerName}`;
    const entry = await classify(workerDir);

    // A file under `workers/` does not occupy a worker slot — a slot is a
    // directory — so it is skipped rather than reported, the way the roster
    // reader skips one.
    if (entry.kind === "absent" || entry.kind === "file") continue;

    // Both refusals are structural: the folder is there and the walk will not
    // go through it, so every file under it is missing and none of them can be
    // named individually. `absent` and `unreadable` stay apart here for the
    // reason they do at every other level — folded together, a folder we cannot
    // stat is skipped in silence and its files disappear with no refusal for a
    // caller's fatal check to look at.
    if (entry.kind === "symlink") {
      yield {
        type: "worker-refused",
        path: entryPath,
        workerName,
        refusal: (named) => refusedSymlink("worker folder", named),
      };
      continue;
    }
    if (entry.kind === "unreadable") {
      const cause = entry.error;
      yield {
        type: "worker-refused",
        path: entryPath,
        workerName,
        refusal: (named) => unreadable("Worker folder", named, cause),
      };
      continue;
    }

    yield {
      type: "place",
      dir: workerDir,
      path: entryPath,
      pattern,
      atWorkerRoot: true,
      mintRef: (name) => mintResourceRef(teamId, workerName, name),
    };
  }
}
