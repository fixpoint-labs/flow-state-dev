/** Types for `mechanism-exports.mjs`, for the TypeScript tests that read it; see that file. */

/** `read(path)` → the file's text, or `null` when it does not exist. */
export interface Reader {
  (path: string): string | null;
  /** The directory names under `packages/`. */
  packageDirs(): string[];
  /** Every file under `dir`, repo-relative. */
  list(dir: string): string[];
  /** Every git-tracked path. */
  tracked(): string[];
  /** The tracked files under `dirs` whose text contains `text`. */
  grep(text: string, dirs: string[]): string[];
}

/** Where an exported name is declared. */
export interface ExportEntry {
  /** The declaring file, repo-relative. */
  file: string;
  /** Whether the name is type-only. */
  type: boolean;
  /** The name it is declared under in `file`, when it is re-exported under another. */
  decl?: string;
}

/** Read files from the working tree under `root`. */
export declare function fsReader(root: string): Reader;

/** Read files as they were at git `ref`. */
export declare function gitReader(root: string, ref: string): Reader;

/** Package name → subpath (`"."`, `"./tasks"`) → export name → where it is declared. */
export declare function packageEntryExports(read: Reader): Map<string, Map<string, Map<string, ExportEntry>>>;

/** Package name → export name → where it is declared, merged across the package's entries. */
export declare function packageExports(read: Reader): Map<string, Map<string, ExportEntry>>;
