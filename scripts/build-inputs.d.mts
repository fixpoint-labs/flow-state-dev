/** Types for `build-inputs.mjs`; see that file for what a build-inputs record is. */
import type { Plugin } from "vite";

/** The record's file name inside a build's output directory. */
export declare const BUILD_INPUTS_FILE: string;

/** A Vite plugin that records the build's repository source files and their hashes. */
export declare function recordBuildInputs(options: { repoRoot: string }): Plugin;

/** Why the build in `buildDir` is older than its source, or `undefined` when it isn't. */
export declare function staleBuildInputs(buildDir: string, repoRoot: string): string | undefined;
