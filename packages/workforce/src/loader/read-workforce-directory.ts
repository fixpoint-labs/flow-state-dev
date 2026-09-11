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
  type WorkerManifest,
} from "../manifest";
import { validateSegment } from "./segments";
import {
  classify,
  openStructuralDirectory,
  refusedSymlink,
  unreadable,
} from "./structural-directory";

/** Filenames that are never a worker folder — editor and OS droppings. */
const IGNORED_ENTRIES = new Set([".DS_Store", "Thumbs.db"]);

/** The document that describes a worker. */
const WORKER_MD = "WORKER.md";

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
  errors: Array<{ path: string; error: Error }>;
}

/**
 * Read every `<root>/teams/<teamId>/workers/<name>/` and return one neutral
 * manifest per worker.
 *
 * Throws only when `root` itself cannot be read — a configured root that does
 * not exist is a wiring mistake, not a per-worker one. A root with no `teams/`
 * is an empty result: an app may declare no workers in files. Everything else
 * that goes wrong lands in `errors`, so one bad folder never costs an app its
 * other workers.
 */
export async function readWorkforceDirectory(
  root: string,
): Promise<ReadWorkforceDirectoryResult> {
  const workers: WorkerManifest[] = [];
  const errors: ReadWorkforceDirectoryResult["errors"] = [];

  try {
    await fs.readdir(root);
  } catch (err) {
    throw new Error(
      `Failed to read workforce directory "${root}": ${(err as Error).message}`,
    );
  }

  const teams = await openStructuralDirectory(path.join(root, "teams"), "teams", errors);
  if (teams === undefined) return { workers, errors };

  for (const teamId of teams) {
    if (IGNORED_ENTRIES.has(teamId)) continue;

    const teamDir = path.join(root, "teams", teamId);
    const teamPath = `teams/${teamId}`;
    const team = await classify(teamDir);
    if (team.kind === "symlink") {
      errors.push({ path: teamPath, error: refusedSymlink("team folder", teamId) });
      continue;
    }
    if (team.kind === "unreadable") {
      errors.push({ path: teamPath, error: unreadable("Team folder", teamId, team.error) });
      continue;
    }
    if (team.kind !== "directory") continue;

    const workersPath = `${teamPath}/workers`;
    const workerEntries = await openStructuralDirectory(
      path.join(teamDir, "workers"),
      workersPath,
      errors,
    );
    if (workerEntries === undefined) continue;

    for (const workerName of workerEntries) {
      if (IGNORED_ENTRIES.has(workerName)) continue;

      const workerDir = path.join(teamDir, "workers", workerName);
      const slot = await classify(workerDir);
      // A file under `workers/` does not occupy a worker slot — a slot is a
      // directory — so it is skipped rather than reported.
      if (slot.kind === "absent" || slot.kind === "file") continue;

      try {
        if (slot.kind === "symlink") throw refusedSymlink("worker folder", workerName);
        if (slot.kind === "unreadable") {
          throw unreadable("Worker folder", workerName, slot.error);
        }
        workers.push(await readWorkerSlot(teamId, workerName, workerDir));
      } catch (err) {
        errors.push({ path: `${workersPath}/${workerName}`, error: err as Error });
      }
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

  if (md.kind !== "file") {
    throw new Error(`Worker folder "${workerName}" has no ${WORKER_MD}`);
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
 * `description` is required, the one refused key is rejected, and everything
 * else is carried verbatim. Both rules are the dialect's, not a consumer's —
 * `SKILL.md` throws on a missing description too — and they are what keeps
 * "carried verbatim" safe to promise: a key nobody has claimed arrives
 * unchanged, but a key that has been *unclaimed* is not the same thing as a key
 * nobody ever read, and reading a file that still uses one as if it simply held
 * an unknown key is how a worker boots with no instructions and no complaint.
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

  if (Object.hasOwn(declared, REFUSED_PERSONA_KEY)) {
    throw new Error(
      `${WORKER_MD} in "${workerName}/" ${REFUSED_PERSONA_KEY_MESSAGE}`,
    );
  }

  return { declared, body };
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
