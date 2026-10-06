/** Types for `vitest-isolation.mjs`; see that file for why a package splits its tests. */
import type { TestProjectInlineConfiguration } from "vitest/config";

export interface IsolationOptions {
  /** The package's `test.include`, when it sets one. */
  include?: string[];
  /** Files that leak or read module state across files. */
  alsoIsolate?: string[];
}

/** The test files under `root` that must run isolated, relative to `root`. */
export declare function isolatedTestFiles(root: string, options?: IsolationOptions): string[];

/** `test` options: `isolate: false` at the root, and `shared` / `isolated` projects. */
export declare function sharedModuleCache(
  root: string,
  options?: IsolationOptions
): { isolate: false; projects: TestProjectInlineConfiguration[] };
