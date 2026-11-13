/**
 * `readWorkforceFolder`: workforce's folder reader, as the workforce kit runs
 * it at start-up.
 *
 * It reads the whole tree through the readers beside it (workers and their
 * skills, teams, packages, documents, references) and claims every file the
 * published convention names, so the engine's claim pass refuses what is left:
 * a file workforce doesn't read stops the app starting, named, instead of
 * loading nothing and saying nothing. Anything a reader couldn't load stops it
 * too, every problem named at once: an app whose tree didn't load is not
 * started short.
 *
 * **The claim set** is the published shapes (`test/published-tree-surface.test.ts`)
 * plus the generated `workforce.gen.ts`: `TEAM.md`, each `WORKER.md`, the
 * documents, references, skills and packages at each level, the code an app
 * registers through `fsdev gen` (`flows/workers/`, `blocks/`, a team's or a
 * worker's `blocks/`, a resource module), and the generated module itself.
 * `flows/` holds only `flows/workers/`: a helper module beside it is the app's
 * and belongs in its own folder.
 *
 * Node-only (`node:fs`), behind the `./loader` subpath.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { KitFolder } from "@flow-state-dev/core";
import { IGNORED_ENTRIES } from "@flow-state-dev/engine/folder";
import type { ResourceDoc, TeamManifest, WorkerManifest } from "../manifest";
import { readDeclaredRoster } from "./read-declared-roster";

/** What `readWorkforceFolder` read: the whole declared tree. */
export interface WorkforceFolder {
  /** One record per worker, in walk order, carrying its skills. */
  readonly workers: readonly WorkerManifest[];
  /** One record per team that declared a `TEAM.md`, in walk order. */
  readonly teams: readonly TeamManifest[];
  /** One record per document under a `resources/` folder, in walk order. */
  readonly documents: readonly ResourceDoc[];
  /** One record per reference under a `references/` folder, in walk order. */
  readonly references: readonly ResourceDoc[];
}

/** A level: where workers, documents, references, skills and packages may sit. */
const LEVEL = String.raw`(?:org|teams/[^/]+|org/workers/[^/]+|teams/[^/]+/workers/[^/]+)`;
/** A TypeScript module, as `fsdev gen` registers one. */
const CODE = String.raw`\.(?:ts|tsx|mts|cts)`;

/** Each path the published convention tells an author they may write, relative to the folder. */
const CLAIMED: readonly RegExp[] = [
  /^workforce\.gen\.ts$/,
  new RegExp(`^flows/workers/[^/]+${CODE}$`),
  new RegExp(`^blocks/[^/]+${CODE}$`),
  /^teams\/[^/]+\/TEAM\.md$/,
  /^(?:org|teams\/[^/]+)\/workers\/[^/]+\/WORKER\.md$/,
  new RegExp(`^${LEVEL}/resources/[^/]+(?:\\.md|${CODE})$`),
  new RegExp(`^${LEVEL}/references/[^/]+\\.md$`),
  new RegExp(`^${LEVEL}/skills/[^/]+/.+$`),
  new RegExp(`^${LEVEL}/packages/[^/]+/(?:PACKAGE\\.md|blocks/[^/]+${CODE})$`),
  new RegExp(`^(?:teams/[^/]+|teams/[^/]+/workers/[^/]+)/blocks/[^/]+${CODE}$`),
];

/** Whether `rel`, a slash-separated path in the folder, is one workforce reads. */
export function isWorkforcePath(rel: string): boolean {
  return CLAIMED.some((rule) => rule.test(rel));
}

/** Every file under `dir`, as slash-separated paths relative to the folder. Links are left to the claim pass, which refuses each. */
async function filesUnder(dir: string, prefix: string, out: string[]): Promise<string[]> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (IGNORED_ENTRIES.has(entry.name)) continue;
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await filesUnder(path.join(dir, entry.name), rel, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/**
 * Read a workforce folder and claim every file workforce reads in it.
 *
 * @param folder The folder, as the engine hands a kit's reader.
 * @returns The whole declared tree.
 * @throws When anything in the tree failed to load, every problem named.
 */
export async function readWorkforceFolder(folder: KitFolder): Promise<WorkforceFolder> {
  const roster = await readDeclaredRoster(folder.path);
  if (roster.problems.length > 0) {
    throw new Error(
      `the workforce folder did not load:\n` +
        roster.problems.map((problem) => `  - ${problem.layer} ${problem.path}: ${problem.error.message}`).join("\n"),
    );
  }
  for (const rel of await filesUnder(folder.path, "", [])) {
    if (isWorkforcePath(rel)) folder.claim(rel);
  }
  return { workers: roster.workers, teams: roster.teams, documents: roster.documents, references: roster.references };
}
