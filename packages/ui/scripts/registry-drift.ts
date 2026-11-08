/**
 * Compare an app's registry copies against the registry's source, both ways.
 *
 * An app that installs registry components gets copies, not a dependency. A
 * copy that silently forks from its source stops being "the registry": a
 * reader who clones the app inherits the fork and never learns they have one.
 * An app that holds itself to byte-identical copies calls this over its own
 * folder and asserts the result is empty.
 *
 * Two directions, because either alone has a blind spot:
 *
 *  - source → copy: every registry source file (stories excluded, plus
 *    whatever the app says it deliberately never installed) has a
 *    byte-identical copy at the same relative path.
 *  - copy → source: every file in the app's folder has a registry source at
 *    the same path, unless the app names it as its own with a reason. A fork
 *    with no source at all is otherwise invisible to the first direction.
 *
 * `compared` is returned so the caller can pin its count: deleting a source
 * file, or quietly excluding one, otherwise shrinks the comparison and passes
 * by comparing less.
 *
 * `refreshRegistryCopies` is the writer beside the checker: given the same
 * options, it copies every file the comparison checks from its source, so an
 * edit to the registry reaches the app with one command and what is copied is
 * what is checked.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The registry's component sources: `packages/ui/registry/components`. */
export const REGISTRY_SOURCE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../registry/components");

/** What to compare. */
export interface RegistryCopyOptions {
  /** The app's folder of copies, e.g. `apps/kitchen-sink/components/flow-state`. */
  readonly targetDir: string;
  /** Registry source files (relative paths) the app deliberately never installed. */
  readonly notInstalled?: (file: string) => boolean;
  /** Files in `targetDir` with no registry source, kept on purpose, each with its reason. */
  readonly appOnly?: Readonly<Record<string, string>>;
  /** Override the source directory. Defaults to {@link REGISTRY_SOURCE_DIR}. */
  readonly sourceDir?: string;
}

/** What differs. Empty `mismatches` and `forks` mean the copies are the registry. */
export interface RegistryCopyDrift {
  /** Source files compared, relative and sorted. */
  readonly compared: string[];
  /** Source files whose copy differs or is missing (`<file> (not installed)`). */
  readonly mismatches: string[];
  /** Files in the app's folder with no source and no `appOnly` reason. */
  readonly forks: string[];
}

/** Every file under `dir`, recursively, as paths relative to `dir`. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full).map((f) => join(entry, f)));
    else out.push(entry);
  }
  return out;
}

/** The source files an app's copies are held to: stories and what it never installed left out. */
function installedSources(sourceDir: string, options: RegistryCopyOptions): string[] {
  const notInstalled = options.notInstalled ?? (() => false);
  return walk(sourceDir)
    .filter((file) => !file.endsWith(".stories.tsx"))
    .filter((file) => !notInstalled(file))
    .sort();
}

/** Compare `targetDir` against the registry's sources in both directions. */
export function compareRegistryCopies(options: RegistryCopyOptions): RegistryCopyDrift {
  const sourceDir = options.sourceDir ?? REGISTRY_SOURCE_DIR;
  const appOnly = options.appOnly ?? {};

  const compared = installedSources(sourceDir, options);

  const mismatches: string[] = [];
  for (const file of compared) {
    const target = join(options.targetDir, file);
    if (!existsSync(target)) {
      mismatches.push(`${file} (not installed)`);
      continue;
    }
    if (readFileSync(join(sourceDir, file), "utf8") !== readFileSync(target, "utf8")) mismatches.push(file);
  }

  const forks = walk(options.targetDir)
    .sort()
    .filter((file) => !(file in appOnly) && !existsSync(join(sourceDir, file)));

  return { compared, mismatches, forks };
}

/**
 * Copy every source file {@link compareRegistryCopies} checks into
 * `targetDir`, overwriting the app's copy. Files the app never installed and
 * its own files are left as they are. Returns the files written, relative and
 * sorted: the comparison's `compared` for the same options.
 */
export function refreshRegistryCopies(options: RegistryCopyOptions): string[] {
  const sourceDir = options.sourceDir ?? REGISTRY_SOURCE_DIR;
  const files = installedSources(sourceDir, options);
  for (const file of files) {
    const target = join(options.targetDir, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(sourceDir, file), target);
  }
  return files;
}
