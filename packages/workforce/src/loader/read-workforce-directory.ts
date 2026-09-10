/**
 * The convention loader — read a workforce tree into neutral worker manifests.
 *
 * Walks `<root>/teams/<teamId>/workers/<workerName>/`, reads each worker's
 * `WORKER.md`, and returns one plain record per worker. It interprets nothing:
 * frontmatter is carried verbatim, so a key a consumer claims tomorrow arrives
 * unchanged today. It builds no flow, no agent and no registry — turning a
 * record into a running seat is the seat factory's job.
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
import type { WorkerManifest } from "../manifest";

/** Filenames that are never a worker folder — editor and OS droppings. */
const IGNORED_ENTRIES = new Set([".DS_Store", "Thumbs.db"]);

/** The document that describes a worker. */
const WORKER_MD = "WORKER.md";

/** The second door: custom code for a seat whose shape a document can't express. */
const WORKER_TS = "worker.ts";

/**
 * Pattern a team or worker folder name must match: lowercase `a-z`/`0-9` runs
 * joined by single hyphens. These are the skill-name rules, adopted rather than
 * shared: the minted identity becomes a flow instance id and a board key, while
 * each segment is separately a path segment on disk, and lowercase-hyphen is the
 * one shape safe in all of them.
 *
 * The allowlist excludes `.`, and that exclusion is load-bearing rather than
 * incidental: `.` is the joiner, so a dotted segment would make the minted id
 * impossible to split back into a team and a name — `a.b.lead` could be read
 * two ways. Do not relax this to admit `.`.
 */
const SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Longest legal team or worker folder name. */
const MAX_SEGMENT_LENGTH = 64;

/** Folder names the framework reserves. */
const RESERVED_SEGMENTS = new Set(["_meta"]);

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
 *
 * Nothing outside a worker slot is reported *as a near-miss*. A team's
 * `resources/`, `skills/` or `tools/` siblings, an org-level `workers/`, and
 * any other path on the tree are passed over in silence: the rule is *the path
 * occupies a worker slot*, not *the path looks like a worker*.
 *
 * Symlinks are never followed, at any level of the walk.
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
    const teamKind = await classify(teamDir);
    if (teamKind === "symlink") {
      errors.push({ path: teamPath, error: refusedSymlink("team folder", teamId) });
      continue;
    }
    if (teamKind !== "directory") continue;

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
      const workerKind = await classify(workerDir);
      // A file under `workers/` does not occupy a worker slot — a slot is a
      // directory — so it is skipped rather than reported.
      if (workerKind === "absent" || workerKind === "file") continue;

      try {
        if (workerKind === "symlink") throw refusedSymlink("worker folder", workerName);
        workers.push(await readWorkerSlot(root, teamId, workerName, workerDir));
      } catch (err) {
        errors.push({ path: `${workersPath}/${workerName}`, error: err as Error });
      }
    }
  }

  return { workers, errors };
}

/**
 * List one of the walk's structural directories — `teams` or a team's
 * `workers`. Returns its entries, or `undefined` when the walk cannot go that
 * way, having reported the reason unless the folder is simply absent.
 *
 * Three outcomes, and keeping them apart is the point. **Absent** is silence: a
 * root with no `teams/`, or a team that declares no workers, is a tree that
 * does not go that way rather than a mistake. **A symlink** is refused without
 * being read — `readdir` follows a directory symlink, so a `teams -> /outside`
 * would otherwise load worker files from outside the configured root and report
 * nothing. **Anything else** — a permission denial, a file where a folder
 * belongs, a failing disk — is reported, because a directory that silently
 * reads as empty takes every seat beneath it out of the roster while leaving
 * `errors` empty, and a caller told to treat `errors` as fatal cannot see that.
 */
async function openStructuralDirectory(
  target: string,
  reportAs: string,
  errors: ReadWorkforceDirectoryResult["errors"],
): Promise<string[] | undefined> {
  if ((await classify(target)) === "symlink") {
    errors.push({ path: reportAs, error: refusedSymlink("directory", reportAs) });
    return undefined;
  }

  try {
    return await fs.readdir(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    errors.push({
      path: reportAs,
      error: new Error(`"${reportAs}" could not be read: ${(err as Error).message}`),
    });
    return undefined;
  }
}

/** The one wording for a refused symlink, wherever the walk meets one. */
function refusedSymlink(what: string, name: string): Error {
  return new Error(`Symlinked ${what} "${name}" — refused for safety`);
}

/**
 * Read one worker slot into a manifest. Throws when the slot cannot produce
 * one; the caller turns that into an `errors` entry keyed by the slot's path.
 */
async function readWorkerSlot(
  root: string,
  teamId: string,
  workerName: string,
  workerDir: string,
): Promise<WorkerManifest> {
  // Identity first: a slot whose segments break the rules has no id to be
  // reported under, so there is nothing to be gained by reading its files.
  const id = mintWorkerId(teamId, workerName);

  const mdKind = await classify(path.join(workerDir, WORKER_MD));
  const tsKind = await classify(path.join(workerDir, WORKER_TS));

  if (mdKind === "symlink" || tsKind === "symlink") {
    throw refusedSymlink(
      mdKind === "symlink" ? WORKER_MD : WORKER_TS,
      `${workerName}/${mdKind === "symlink" ? WORKER_MD : WORKER_TS}`,
    );
  }

  // Recorded, never imported. Joined onto the root the caller passed rather
  // than absolutised, so the path stays in the caller's own frame of reference.
  const codePath =
    tsKind === "file"
      ? path.join(root, "teams", teamId, "workers", workerName, WORKER_TS)
      : undefined;

  if (mdKind !== "file") {
    if (codePath === undefined) {
      throw new Error(
        `Worker folder "${workerName}" has neither a ${WORKER_MD} nor a ${WORKER_TS}`,
      );
    }
    // The second door: a seat whose shape is code. Valid to this loader — it
    // declares nothing and instructs nothing, and what a consumer does with a
    // record that names no flow kind is that consumer's rule, not this one's.
    return { id, declared: {}, body: "", codePath };
  }

  const text = await fs.readFile(path.join(workerDir, WORKER_MD), "utf8");
  const { declared, body } = parseWorkerMd(text, workerName);

  return codePath === undefined
    ? { id, declared, body }
    : { id, declared, body, codePath };
}

/**
 * Parse a `WORKER.md` into its declared settings and its body. Shares the
 * `SKILL.md` frontmatter dialect deliberately: these are the two convention
 * files an author writes by hand, and a second dialect would mean learning one
 * teaches the wrong thing about the other.
 *
 * `description` is required and everything else is carried verbatim. The
 * requirement is the dialect's, not a consumer's — `SKILL.md` throws on a
 * missing description too — and it keeps a roster legible to whoever reads it.
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

/** Validate one path segment against the naming rules. Throws on a break. */
function validateSegment(segment: string, label: "Team" | "Worker"): void {
  if (segment.length > MAX_SEGMENT_LENGTH) {
    throw new Error(
      `${label} folder name "${segment}" exceeds ${MAX_SEGMENT_LENGTH} characters`,
    );
  }
  if (RESERVED_SEGMENTS.has(segment)) {
    throw new Error(`${label} folder name "${segment}" is reserved`);
  }
  if (!SEGMENT_PATTERN.test(segment)) {
    throw new Error(
      `${label} folder name "${segment}" must be lowercase letters, digits, and single ` +
        `hyphens (not at the start or end) — it becomes part of the worker's identity, ` +
        `which is joined with a "."`,
    );
  }
}

/** What a path is, without following symlinks. */
type EntryKind = "directory" | "file" | "symlink" | "absent";

/**
 * Classify a path without following symlinks. Symlinks are never followed: a
 * workforce tree can come from anywhere, and one could escape the root or point
 * at something sensitive.
 */
async function classify(target: string): Promise<EntryKind> {
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isDirectory()) return "directory";
    if (stat.isFile()) return "file";
    return "absent";
  } catch {
    return "absent";
  }
}
