/**
 * `@flow-state-dev/workforce/fsdev-gen` — the generator `fsdev gen` runs for
 * an app that depends on this package.
 *
 * `fsdev gen` knows nothing about this convention. It looks through the app's
 * dependencies for one exporting a `./fsdev-gen` subpath, and calls the
 * `generator` it finds there: read the root, hand back the file. Writing it,
 * `--check`, and the exit code stay with the command; every rule about what the
 * tree may hold, and every refusal, stays here.
 *
 * A refusal of the tree is a {@link WorkforceCodeError}, whose `problems` list
 * is what tells the command it was the tree, not the setup, that failed.
 */
import { discoverWorkforceCode } from "./discover";
import { GENERATED_FILE_NAME, renderWorkforceCode } from "./render";

/** What one run found and rendered, in the shape `fsdev gen` takes. */
export interface WorkforceGeneratedModule {
  /** The file to write, relative to the root. */
  file: string;
  /** The rendered module. */
  content: string;
  /** The folders looked in. */
  searched: string[];
  /** One line per registration, `path -> name`, ordered by path. */
  entries: string[];
  /** Every discovered file, one entry each: what a stale report names. */
  paths: string[];
  /** The counts, for the summary line. */
  summary: string;
}

/** Walk `root` and render `workforce.gen.ts` from what is there. */
async function generate(root: string): Promise<WorkforceGeneratedModule> {
  const { files, resourceModules, seatBlocks, packageBlocks, searched } =
    await discoverWorkforceCode(root);
  const content = renderWorkforceCode(files, resourceModules, seatBlocks, packageBlocks);

  const counts = { worker: 0, mailbox: 0, block: 0 };
  for (const file of files) counts[file.slot] += 1;
  // Per-worker blocks are counted and listed by FILE rather than by
  // registration: one team-level file registers for every worker on the team,
  // and a count of registrations would not match the files an author can see.
  const seatBlockPaths = [...new Set(seatBlocks.map((entry) => entry.path))];

  return {
    file: GENERATED_FILE_NAME,
    content,
    searched,
    entries: [
      ...files.map((file) => `${file.path} -> ${file.name}`),
      ...resourceModules.map((module) => `${module.path} -> ${module.ref}`),
      ...seatBlocks.map((entry) => `${entry.path} -> ${entry.seat}.${entry.name}`),
      ...packageBlocks.map((entry) => `${entry.path} -> ${entry.package}: ${entry.name}`),
    ],
    paths: [
      ...[...files, ...resourceModules].map((found) => found.path),
      ...seatBlockPaths,
      ...packageBlocks.map((entry) => entry.path),
    ],
    summary:
      `${counts.worker} worker kind(s), ${counts.mailbox} mailbox kind(s), ` +
      `${counts.block} block(s), ${resourceModules.length} resource module(s), ` +
      `${seatBlockPaths.length} seat block(s), ${packageBlocks.length} package block(s)`,
  };
}

/** The generator `fsdev gen` finds on this subpath. */
export const generator = {
  /** The workforce tree's folder, relative to where the command runs. */
  defaultRoot: "workforce",
  generate,
};
