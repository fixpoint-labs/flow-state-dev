/**
 * `fsdev gen` command — write the module an app registers its code from, using
 * the generator one of the app's dependencies supplies.
 *
 * The command knows no convention. It reads the `package.json` nearest the
 * working directory, and for each dependency looks for a `./fsdev-gen` subpath
 * export whose `generator` takes a root and hands back the file to write. The
 * generator owns every rule about what the root may hold and every refusal of
 * it; this command owns the file it writes, `--check`, and the exit code.
 *
 * It loads no app code. Not the app's `fsdev.config.ts`, and not one file under
 * the root: the published CLI is compiled JavaScript on plain Node with no
 * TypeScript runner, and an app's own files resolve through the app's aliases.
 * The generator is a package the app installed, not a file it wrote.
 *
 * `--check` renders and compares without writing, exiting non-zero on a
 * difference. It belongs in CI as its own step — put it inside a build script
 * and the build would regenerate the file and pass.
 */
import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { lstat, writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { CliError } from "../resolve-block";
import { EXIT_SUCCESS, EXIT_CONFIG_ERROR, EXIT_EXECUTION_ERROR } from "../exit-codes";

/** The subpath a package exports its generator on. */
export const GENERATOR_SUBPATH = "fsdev-gen";

/** What a generator hands back from one run. */
export interface GeneratedModule {
  /** The file to write, relative to the root. */
  file: string;
  /** The module's full text. */
  content: string;
  /** The folders looked in, printed before the entries. */
  searched: string[];
  /** One line per registration, printed as found. */
  entries: string[];
  /** Every discovered path, listed when `--check` finds the file stale. */
  paths: string[];
  /** A one-line count of what was found. */
  summary: string;
}

/**
 * The `generator` a package exports on `./fsdev-gen`.
 *
 * A refusal of what the root holds is thrown as an error carrying a
 * `problems` array; the command exits 1 on it. Any other throw is read as a
 * setup problem and exits 3.
 */
export interface FsdevGenerator {
  /** The root, relative to the working directory, when `--root` is not given. */
  defaultRoot: string;
  /** Read `root` (absolute) and render the module. Must not write. */
  generate(root: string): Promise<GeneratedModule>;
}

/** Options `fsdev gen` accepts. */
export interface GenCommandOptions {
  /** The directory the generator reads. Defaults to the generator's own. */
  root?: string;
  /** Compare against the committed file instead of writing it, and exit non-zero on a difference. */
  check?: boolean;
}

/** What one `fsdev gen` run did, for a caller that wants it without the process exiting. */
export interface GenResult extends Omit<GeneratedModule, "file" | "content"> {
  /** The package whose generator ran. */
  generator: string;
  /** Absolute path of the generated module. */
  file: string;
  /** True when the file on disk already matched — always true for a write that changed nothing. */
  upToDate: boolean;
}

/** The nearest `package.json` at or above `cwd`, or `undefined` when there is none. */
function nearestManifest(cwd: string): string | undefined {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * The one generator the app's dependencies supply, and the package it came
 * from. Resolved from the app's `package.json`, as the app itself would.
 *
 * @throws CliError (exit 3) when there is no `package.json`, when no
 *   dependency supplies a generator, when more than one does, or when one
 *   exports something that is not a generator.
 */
export async function resolveGenerator(
  cwd: string,
): Promise<{ name: string; generator: FsdevGenerator }> {
  const manifest = nearestManifest(cwd);
  if (manifest === undefined) {
    throw new CliError(`No package.json at or above ${cwd}, so no generator to run.`, EXIT_CONFIG_ERROR);
  }
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const names = [
    ...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]),
  ].sort();
  const require = createRequire(manifest);
  const found: { name: string; path: string }[] = [];
  for (const name of names) {
    try {
      found.push({ name, path: require.resolve(`${name}/${GENERATOR_SUBPATH}`) });
    } catch {
      // Not exported, or not installed: either way, not a generator.
    }
  }
  if (found.length === 0) {
    throw new CliError(
      `No dependency in ${manifest} exports a generator on "./${GENERATOR_SUBPATH}".`,
      EXIT_CONFIG_ERROR,
    );
  }
  if (found.length > 1) {
    throw new CliError(
      `More than one dependency exports a generator: ${found.map((f) => f.name).join(", ")}.`,
      EXIT_CONFIG_ERROR,
    );
  }
  const [{ name, path }] = found;
  const mod = (await import(pathToFileURL(path).href)) as { generator?: Partial<FsdevGenerator> };
  const generator = mod.generator;
  if (
    generator === undefined ||
    typeof generator.defaultRoot !== "string" ||
    typeof generator.generate !== "function"
  ) {
    throw new CliError(
      `${name}/${GENERATOR_SUBPATH} does not export a \`generator\` with \`defaultRoot\` and \`generate\`.`,
      EXIT_CONFIG_ERROR,
    );
  }
  return { name, generator: generator as FsdevGenerator };
}

/** Whether `error` is a generator's refusal of what the root holds. */
function isRefusal(error: unknown): boolean {
  return error instanceof Error && Array.isArray((error as { problems?: unknown }).problems);
}

/**
 * Run the app's generator and render the module, returning what happened.
 *
 * Writes nothing when `check` is set. Exported so a caller can drive the
 * command without a process exit.
 *
 * @param options Where to look, and whether to write.
 * @returns The rendered file's path, what was found, and whether disk matched.
 * @throws CliError (exit 3) as {@link resolveGenerator}.
 * @throws Whatever the generator throws, including its refusals.
 */
export async function executeGenCommand(options: GenCommandOptions): Promise<GenResult> {
  const { name, generator } = await resolveGenerator(process.cwd());
  const root = resolve(process.cwd(), options.root ?? generator.defaultRoot);
  const { file: fileName, content, ...found } = await generator.generate(root);
  const file = join(root, fileName);

  // The no-follow promise covers what we WRITE as well as what the generator
  // read. Both calls below follow a symlink: `writeFile` would overwrite
  // whatever it points at, outside the root, and `readFile` would compare
  // against a file that is not this app's. Checked before either, and in
  // `--check` mode too, since the wrong comparison is its own kind of wrong.
  const stat = await lstat(file).catch(() => undefined);
  if (stat?.isSymbolicLink() === true) {
    throw new Error(`Symlinked generated file "${fileName}" — refused for safety`);
  }

  const onDisk = await readFile(file, "utf-8").catch(() => undefined);
  // Compared on content, not on bytes: a checkout with `core.autocrlf=true`
  // hands back the committed file with CRLF while the renderer always emits
  // LF, which would report a clean tree as stale and fail CI on Windows for a
  // difference git introduced. Only the comparison normalises — what gets
  // written stays LF.
  const upToDate = onDisk !== undefined && onDisk.replace(/\r\n/g, "\n") === content;

  if (options.check !== true && !upToDate) await writeFile(file, content, "utf-8");

  return { generator: name, file, ...found, upToDate };
}

export function registerGenCommand(program: Command): void {
  program
    .command("gen")
    .description(
      "Generate the module an app registers its code from, with the generator a dependency supplies",
    )
    .option("--root <dir>", "The directory the generator reads (default: the generator's own)")
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
        process.exitCode = isRefusal(error) ? EXIT_EXECUTION_ERROR : EXIT_CONFIG_ERROR;
        return;
      }

      const shown = relative(process.cwd(), result.file) || result.file;

      if (options.check === true) {
        if (result.upToDate) {
          console.log(`${shown} is up to date (${result.summary}).`);
          process.exitCode = EXIT_SUCCESS;
          return;
        }
        // Names what it expected rather than only that something differs, so a
        // CI log is enough to see whether a file was added or a name changed.
        // Which is also why this report must outlive the exit.
        console.error(
          `${shown} is out of date. Run \`fsdev gen\` and commit the result.\n` +
            `The tree holds ${result.summary}:\n` +
            result.paths
              .map((path) => `  - ${path}`)
              .join("\n"),
        );
        process.exitCode = EXIT_EXECUTION_ERROR;
        return;
      }

      console.log(`Looked in: ${result.searched.join(", ")}`);
      for (const entry of result.entries) console.log(`  ${entry}`);
      console.log(
        result.upToDate
          ? `${shown} unchanged (${result.summary}).`
          : `Wrote ${shown} (${result.summary}).`,
      );
      // Set on success as well, and for the same reason the `--check` success
      // branch does: a code already on the process outlives a run that printed
      // success, so the host would exit as a failure after a command that
      // worked. Two branches doing one job have to agree.
      process.exitCode = EXIT_SUCCESS;
    });
}
