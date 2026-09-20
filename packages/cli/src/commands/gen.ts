/**
 * `fsdev gen` command — write the module that registers an app's custom flow
 * kinds, blocks and resource modules, from the files that already declare them.
 *
 * Thin by design: it resolves the workforce root, calls the convention in
 * `@flow-state-dev/workforce/codegen`, writes the file and prints what it
 * found. Every rule about what the tree may hold, and every refusal, belongs to
 * that convention — this command decides nothing about registration.
 *
 * It loads no app code. Not the app's `fsdev.config.ts`, and not one file it
 * walked: the published CLI is compiled JavaScript on plain Node with no
 * TypeScript runner, and an app's own files resolve through the app's aliases.
 * Reading the tree needs neither.
 *
 * `--check` renders and compares without writing, exiting non-zero on a
 * difference. It belongs in CI as its own step — put it inside a build script
 * and the build would regenerate the file and pass.
 */
import type { Command } from "commander";
import { writeFile, readFile } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import {
  GENERATED_FILE_NAME,
  WorkforceCodeError,
  discoverWorkforceCode,
  renderWorkforceCode,
  type DiscoveredFile,
  type DiscoveredResourceModule,
  type DiscoveredSeatBlock,
} from "@flow-state-dev/workforce/codegen";
import { classify, refusedSymlink } from "@flow-state-dev/workforce/loader";
import { EXIT_SUCCESS, EXIT_CONFIG_ERROR, EXIT_EXECUTION_ERROR } from "../exit-codes";

/** Default location of an app's workforce tree, relative to where the command runs. */
const DEFAULT_ROOT = "workforce";

/** Options `fsdev gen` accepts. */
export interface GenCommandOptions {
  /** The workforce directory. Defaults to `workforce` under the current directory. */
  root: string;
  /** Compare against the committed file instead of writing it, and exit non-zero on a difference. */
  check?: boolean;
}

/** What one `fsdev gen` run did, for a caller that wants it without the process exiting. */
export interface GenResult {
  /** Absolute path of the generated module. */
  file: string;
  /** Every discovered file, ordered by path. */
  files: DiscoveredFile[];
  /** Every discovered resource module, ordered by path. */
  resourceModules: DiscoveredResourceModule[];
  /** Every per-seat block registration, ordered by path then seat. */
  seatBlocks: DiscoveredSeatBlock[];
  /** The folders looked in. */
  searched: string[];
  /** True when the file on disk already matched — always true for a write that changed nothing. */
  upToDate: boolean;
}

/** Group what was discovered by the map each one lands on, for the summary line. */
function countBySlot(
  result: Pick<GenResult, "files" | "resourceModules" | "seatBlocks">,
): string {
  const counts = { worker: 0, channel: 0, block: 0 };
  for (const file of result.files) counts[file.slot] += 1;
  // Seat blocks are counted by FILE rather than by registration: one team-level
  // file registers for every seat on the team, and a count of registrations
  // would not match the number of files an author can point at.
  const seatBlockFiles = new Set(result.seatBlocks.map((entry) => entry.path)).size;
  return (
    `${counts.worker} worker kind(s), ${counts.channel} channel kind(s), ` +
    `${counts.block} block(s), ${result.resourceModules.length} resource module(s), ` +
    `${seatBlockFiles} seat block(s)`
  );
}

/** Every discovered path, in one list, for the report that names what disagreed. */
function discoveredPaths(
  result: Pick<GenResult, "files" | "resourceModules" | "seatBlocks">,
): string[] {
  const seatBlockPaths = [...new Set(result.seatBlocks.map((entry) => entry.path))];
  return [
    ...[...result.files, ...result.resourceModules].map((found) => found.path),
    ...seatBlockPaths,
  ];
}

/**
 * Walk the tree and render the module, returning what happened.
 *
 * Writes nothing when `check` is set. Exported so a caller can drive the
 * command without a process exit.
 *
 * @param options Where to look, and whether to write.
 * @returns The rendered file's path, what was found, and whether disk matched.
 * @throws {WorkforceCodeError} If the tree holds anything the convention refuses.
 */
export async function executeGenCommand(options: GenCommandOptions): Promise<GenResult> {
  const root = resolve(process.cwd(), options.root);
  // The root's own refusals — symlinked, missing, unreadable — belong to the
  // walk and are made there, so every caller of it gets them and not just this
  // command.
  const { files, resourceModules, seatBlocks, searched } = await discoverWorkforceCode(root);
  const rendered = renderWorkforceCode(files, resourceModules, seatBlocks);
  const file = join(root, GENERATED_FILE_NAME);

  // The no-follow promise covers what we WRITE as well as what we read. Both
  // calls below follow a symlink: `writeFile` would overwrite whatever it
  // points at, outside the configured root, and `readFile` would compare
  // against a file that is not this app's. Checked before either, and in
  // `--check` mode too, since the wrong comparison is its own kind of wrong.
  if ((await classify(file)).kind === "symlink") {
    throw refusedSymlink("generated file", GENERATED_FILE_NAME);
  }

  const onDisk = await readFile(file, "utf-8").catch(() => undefined);
  // Compared on content, not on bytes: a checkout with `core.autocrlf=true`
  // hands back the committed file with CRLF while the renderer always emits
  // LF, which would report a clean tree as stale and fail CI on Windows for a
  // difference git introduced. Only the comparison normalises — what gets
  // written stays LF.
  const upToDate = onDisk !== undefined && onDisk.replace(/\r\n/g, "\n") === rendered;

  if (options.check !== true && !upToDate) await writeFile(file, rendered, "utf-8");

  return { file, files, resourceModules, seatBlocks, searched, upToDate };
}

export function registerGenCommand(program: Command): void {
  program
    .command("gen")
    .description(
      "Generate the module registering an app's custom flow kinds, blocks and resource modules",
    )
    .option("--root <dir>", "The workforce directory", DEFAULT_ROOT)
    .option("--check", "Fail instead of writing when the generated file is out of date")
    .action(async (options: GenCommandOptions) => {
      // Every branch sets `process.exitCode` and returns rather than calling
      // `process.exit()`, as the rest of the CLI's commands do — the only
      // `process.exit()` calls left in this package are the two servers'
      // signal handlers, where the process genuinely has to be forced down.
      // `process.exit()` terminates before a piped stdout/stderr has flushed,
      // and CI gives it a pipe, so the status would survive while the
      // explanation beneath it was truncated or lost.
      let result: GenResult;
      try {
        result = await executeGenCommand(options);
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode =
          error instanceof WorkforceCodeError ? EXIT_EXECUTION_ERROR : EXIT_CONFIG_ERROR;
        return;
      }

      const shown = relative(process.cwd(), result.file) || result.file;

      if (options.check === true) {
        if (result.upToDate) {
          console.log(`${shown} is up to date (${countBySlot(result)}).`);
          process.exitCode = EXIT_SUCCESS;
          return;
        }
        // Names what it expected rather than only that something differs, so a
        // CI log is enough to see whether a file was added or a name changed.
        // Which is also why this report must outlive the exit.
        console.error(
          `${shown} is out of date. Run \`fsdev gen\` and commit the result.\n` +
            `The tree holds ${countBySlot(result)}:\n` +
            discoveredPaths(result)
              .map((path) => `  - ${path}`)
              .join("\n"),
        );
        process.exitCode = EXIT_EXECUTION_ERROR;
        return;
      }

      console.log(`Looked in: ${result.searched.join(", ")}`);
      for (const file of result.files) console.log(`  ${file.path} -> ${file.name}`);
      for (const module of result.resourceModules) {
        console.log(`  ${module.path} -> ${module.ref}`);
      }
      for (const entry of result.seatBlocks) {
        console.log(`  ${entry.path} -> ${entry.seat}.${entry.name}`);
      }
      console.log(
        result.upToDate
          ? `${shown} unchanged (${countBySlot(result)}).`
          : `Wrote ${shown} (${countBySlot(result)}).`,
      );
      // Set on success as well, and for the same reason the `--check` success
      // branch does: a code already on the process outlives a run that printed
      // success, so the host would exit as a failure after a command that
      // worked. Two branches doing one job have to agree.
      process.exitCode = EXIT_SUCCESS;
    });
}
