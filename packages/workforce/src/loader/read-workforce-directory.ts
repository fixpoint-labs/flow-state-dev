/**
 * The convention loader — read a workforce tree into neutral worker manifests.
 *
 * Walks `<root>/teams/<teamId>/workers/<workerName>/`, reads each worker's
 * `WORKER.md`, and returns one plain record per worker. Frontmatter is carried
 * verbatim, so a key a consumer claims tomorrow arrives unchanged today; the
 * only keys it reads are the dialect's own — a required `description`, and the
 * one key it refuses by name. It builds no flow, no agent and no
 * registry — turning a record into a running seat is the seat factory's job.
 *
 * Two rules run through the whole walk. **Symlinks are never followed**, at any
 * level. And **only a worker slot is reported as a near-miss** — a directory
 * directly under `teams/<id>/workers/`; the rule is *the path occupies a worker
 * slot*, not *the path looks like a worker*, so a team's `resources/`,
 * `skills/` or `tools/` siblings and an org-level `workers/` are passed over in
 * silence.
 *
 * Node-only (`node:fs`), which is why it ships behind the `./loader` subpath
 * rather than the package root.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  parseFrontmatterYaml,
  splitFrontmatter,
} from "@flow-state-dev/orchestration";
import {
  REFUSED_PERSONA_KEY,
  REFUSED_PERSONA_KEY_MESSAGE,
  REFUSED_SEAT_SKILLS_KEY_MESSAGE,
  REFUSED_TEAM_INSTRUCTIONS_KEY_MESSAGE,
  SEAT_SKILLS_KEY,
  TEAM_INSTRUCTIONS_KEY,
  type WorkerManifest,
} from "../manifest";
import { validateSegment } from "./segments";
import {
  IGNORED_ENTRIES,
  type PathReport,
  classify,
  openRoot,
  openStructuralDirectory,
  refusedSymlink,
  unreadable,
  walkTeams,
} from "./structural-directory";

/** The document that describes a worker. */
const WORKER_MD = "WORKER.md";

/**
 * Why one thing that should have produced a worker did not — the discriminant
 * on every entry in {@link ReadWorkforceDirectoryResult.errors}.
 *
 * Three conditions land in one flat array, and a caller that wants to tolerate
 * one class while refusing another needs to tell them apart without matching on
 * `error.message`. That is all this is for: the message text is unchanged, and
 * every entry still carries the `path` it always did.
 */
export type WorkerManifestErrorKind =
  /** A structural folder — `teams`, a team, or a `workers/` slot — is a symlink or is there and could not be listed. Every worker under it is missing. */
  | "unreadable-slot"
  /** One worker folder did not load: an unusable name, a symlinked folder, or a missing, unreadable or malformed `WORKER.md`. */
  | "worker-load-failed"
  /** A `WORKER.md` declares a key the framework imposes, so the worker is left out. */
  | "refused-declaration";

/** One path that should have produced a worker and did not. */
export type WorkerManifestError = PathReport<WorkerManifestErrorKind>;

/** What `readWorkforceDirectory` hands back. */
export interface ReadWorkforceDirectoryResult {
  /** One record per worker that loaded, in walk order. */
  workers: WorkerManifest[];
  /**
   * One entry per path that should have produced workers and did not, keyed by
   * its slash-separated path relative to the root — deliberately not by an
   * identity, because a folder that breaks the segment rules has no identity to
   * be reported under.
   *
   * Usually a worker slot. It can also be a structural folder — `teams`,
   * `teams/<id>`, `teams/<id>/workers` — when that folder is refused or
   * unreadable, because the seats beneath it cannot be enumerated to be named
   * individually and silence there would hide all of them at once.
   *
   * Collected rather than thrown, because a library that hands back data does
   * not get to set an app's boot policy. That makes treating a non-empty
   * `errors` as fatal the caller's call to make explicitly — and it is very
   * often the right one: a reported path is a seat, or a set of seats, the app
   * was supposed to have, so booting past it boots a short roster with nothing
   * said.
   */
  errors: WorkerManifestError[];
}

/**
 * Read every `<root>/teams/<teamId>/workers/<name>/` and return one neutral
 * manifest per worker.
 *
 * Throws only when `root` itself is refused — a symlink, or a path that cannot
 * be read at all. A configured root that does not exist, or that would take the
 * walk somewhere else entirely, is a wiring mistake, not a per-worker one.
 *
 * A root with no `teams/`
 * is an empty result: an app may declare no workers in files. Everything else
 * that goes wrong lands in `errors`, so one bad folder never costs an app its
 * other workers.
 */
export async function readWorkforceDirectory(
  root: string,
): Promise<ReadWorkforceDirectoryResult> {
  const workers: WorkerManifest[] = [];
  const errors: ReadWorkforceDirectoryResult["errors"] = [];

  await openRoot(root);

  /** File a structural refusal the shared walk met on the way to a team. */
  const report = (at: string, error: Error): void => {
    errors.push({ path: at, error, kind: "unreadable-slot" });
  };

  for await (const team of walkTeams(root, report)) {
    const workersPath = `${team.path}/workers`;
    const workerSlots = await openStructuralDirectory(
      path.join(team.dir, "workers"),
      workersPath,
    );
    if (workerSlots.refusal !== undefined) {
      errors.push({
        path: workersPath,
        error: workerSlots.refusal.error,
        kind: "unreadable-slot",
      });
    }
    if (workerSlots.entries === undefined) continue;

    for (const workerName of workerSlots.entries) {
      if (IGNORED_ENTRIES.has(workerName)) continue;

      const workerDir = path.join(team.dir, "workers", workerName);
      const entryPath = `${workersPath}/${workerName}`;
      const slot = await classify(workerDir);
      // A file under `workers/` does not occupy a worker slot — a slot is a
      // directory — so it is skipped rather than reported.
      if (slot.kind === "absent" || slot.kind === "file") continue;

      let loaded: WorkerManifest;
      try {
        if (slot.kind === "symlink") throw refusedSymlink("worker folder", workerName);
        if (slot.kind === "unreadable") {
          throw unreadable("Worker folder", workerName, slot.error);
        }
        loaded = await readWorkerSlot(team.id, workerName, workerDir);
      } catch (err) {
        errors.push({ path: entryPath, error: err as Error, kind: "worker-load-failed" });
        continue;
      }

      // A separate condition for a caller, so it is a separate branch: a folder
      // that could not be read is an author's typo, and a file declaring what
      // the framework imposes is an author's misunderstanding. Checked here
      // rather than inside the parse so the two stay tellable apart by control
      // flow, the way the channels and resources readers keep them apart.
      const refused = refusedDeclaration(loaded.declared, workerName);
      if (refused !== undefined) {
        errors.push({ path: entryPath, error: refused, kind: "refused-declaration" });
        continue;
      }

      workers.push(loaded);
    }
  }

  return { workers, errors };
}

/**
 * Read one worker slot into a manifest. Throws when the slot cannot produce
 * one; the caller turns that into an `errors` entry keyed by the slot's path.
 */
async function readWorkerSlot(
  teamId: string,
  workerName: string,
  workerDir: string,
): Promise<WorkerManifest> {
  // Identity first: a slot whose segments break the rules has no id to be
  // reported under, so there is nothing to be gained by reading its file.
  const id = mintWorkerId(teamId, workerName);

  const md = await classify(path.join(workerDir, WORKER_MD));

  if (md.kind === "symlink") {
    throw refusedSymlink(WORKER_MD, `${workerName}/${WORKER_MD}`);
  }

  // A file that is there and unreadable is not a file that is missing: falling
  // through would read this slot as empty rather than as broken.
  if (md.kind === "unreadable") {
    throw unreadable(WORKER_MD, `${workerName}/${WORKER_MD}`, md.error);
  }

  // The slot is empty of the one filename this loader knows. Whatever else is
  // in the folder, the author has a route, and this message is the only place
  // they are standing when they find out — so it names the route rather than
  // just the wall. Deliberately the same sentence for every such slot: the
  // loader does not look at what else the folder holds, because recognizing a
  // second filename in order to say something kinder about it is how that
  // filename becomes a thing the framework means to run.
  if (md.kind !== "file") {
    throw new Error(
      `Worker folder "${workerName}" has no ${WORKER_MD}. A worker folder describes a ` +
        `seat, and every seat is a ${WORKER_MD}. A worker whose behavior differs is a ` +
        `different flow kind: define the flow in your app, pass it to hireWorkforce in ` +
        `\`kinds\`, and name it in this worker's \`flow:\`.`,
    );
  }

  const text = await fs.readFile(path.join(workerDir, WORKER_MD), "utf8");
  const { declared, body } = parseWorkerMd(text, workerName);

  return { id, declared, body };
}

/**
 * Parse a `WORKER.md` into its declared settings and its body. Shares the
 * `SKILL.md` frontmatter dialect deliberately: these are the two convention
 * files an author writes by hand, and a second dialect would mean learning one
 * teaches the wrong thing about the other.
 *
 * `description` is required — the dialect's rule, not a consumer's; `SKILL.md`
 * throws on a missing description too — and everything else is carried
 * verbatim. The keys the framework imposes are refused by the caller, which
 * reports that as its own condition ({@link refusedDeclaration}).
 */
function parseWorkerMd(
  text: string,
  workerName: string,
): { declared: Record<string, unknown>; body: string } {
  const { yaml, body } = splitFrontmatter(text);
  if (yaml.trim().length === 0) {
    throw new Error(
      `${WORKER_MD} in "${workerName}/" has no frontmatter — a worker file needs at least a \`description\``,
    );
  }

  const declared = parseFrontmatterYaml(yaml);
  const description = declared["description"];
  if (typeof description !== "string" || description.trim().length === 0) {
    throw new Error(
      `${WORKER_MD} in "${workerName}/" must declare a non-empty \`description\``,
    );
  }

  return { declared, body };
}

/**
 * The refusal a `WORKER.md` earns by declaring a key the framework imposes, or
 * `undefined` when it declares neither.
 *
 * Both rules are the dialect's, not a consumer's, and they are what keeps
 * "carried verbatim" safe to promise: a key nobody has claimed arrives
 * unchanged, but a key that has been *unclaimed* is not the same thing as a key
 * nobody ever read, and reading a file that still uses one as if it simply held
 * an unknown key is how a worker boots with no instructions and no complaint.
 *
 * Checked in the order the two keys were added, so a file using both names the
 * first of them — the same sentence a reader saw before this became its own
 * condition.
 */
function refusedDeclaration(
  declared: Record<string, unknown>,
  workerName: string,
): Error | undefined {
  if (Object.hasOwn(declared, REFUSED_PERSONA_KEY)) {
    return new Error(`${WORKER_MD} in "${workerName}/" ${REFUSED_PERSONA_KEY_MESSAGE}`);
  }

  // The second imposed key, refused at this door for the reason the first is.
  if (Object.hasOwn(declared, SEAT_SKILLS_KEY)) {
    return new Error(`${WORKER_MD} in "${workerName}/" ${REFUSED_SEAT_SKILLS_KEY_MESSAGE}`);
  }

  // The third. Refused from the shared constant, never a literal spelled in
  // here, so a rename moves this door with the others instead of leaving one
  // of them open with nothing said.
  if (Object.hasOwn(declared, TEAM_INSTRUCTIONS_KEY)) {
    return new Error(`${WORKER_MD} in "${workerName}/" ${REFUSED_TEAM_INSTRUCTIONS_KEY_MESSAGE}`);
  }

  return undefined;
}

/**
 * Mint a worker's whole identity from its folder: `"<teamId>.<workerName>"`.
 *
 * The one place this string is built. Team-qualified so two teams can each have
 * a "lead" without coordinating names, and dot-joined because a `/` inside an
 * id survives registration and then fails to route — the identity is a flow
 * instance id, and a slashed one 404s on every flow route.
 *
 * Throws when either segment breaks the rules, naming the rule: an id that
 * cannot be addressed is worse than a startup failure.
 */
function mintWorkerId(teamId: string, workerName: string): string {
  validateSegment(teamId, "Team");
  validateSegment(workerName, "Worker");
  return `${teamId}.${workerName}`;
}
