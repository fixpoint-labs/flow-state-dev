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
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

/** Compare `targetDir` against the registry's sources in both directions. */
export function compareRegistryCopies(options: RegistryCopyOptions): RegistryCopyDrift {
  const sourceDir = options.sourceDir ?? REGISTRY_SOURCE_DIR;
  const notInstalled = options.notInstalled ?? (() => false);
  const appOnly = options.appOnly ?? {};

  const compared = walk(sourceDir)
    .filter((file) => !file.endsWith(".stories.tsx"))
    .filter((file) => !notInstalled(file))
    .sort();

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
