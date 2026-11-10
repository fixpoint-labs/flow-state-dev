/**
 * Rebuild a page when a file its last build was made from changes.
 *
 * `pnpm dev` keeps each hosted page current, so a browser refresh shows an
 * edit. It used to run `vite build --watch` per page for that. A watching
 * build keeps its whole module graph between builds, about 1.5GB a page, and
 * every rebuild added more until V8's heap limit killed it: four of them were
 * most of an 8GB dev run, and on a 2GB heap limit the first edit ended them.
 *
 * Here nothing stays in memory between builds. The build records the source
 * files it was made from (`recordBuildInputs()` in `scripts/build-inputs.mjs`),
 * the folders holding those files are watched with `fs.watch`, and a change
 * to a recorded file runs one ordinary `vite build`, which exits when done.
 * Changes during a build queue one more build after it.
 */
import { existsSync, readFileSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { BUILD_INPUTS_FILE, staleBuildInputs } from "../../scripts/build-inputs.mjs";

/**
 * The absolute paths of the files the build in `outDir` was made from, or
 * `undefined` when it has no record.
 *
 * @param {string} outDir
 * @param {string} repoRoot
 * @returns {string[] | undefined}
 */
export function recordedInputs(outDir, repoRoot) {
  const record = join(outDir, BUILD_INPUTS_FILE);
  if (!existsSync(record)) return undefined;
  try {
    return Object.keys(JSON.parse(readFileSync(record, "utf8")).inputs).map((path) => join(repoRoot, path));
  } catch {
    return undefined;
  }
}

/**
 * Keep the build in `outDir` current: build now when it is missing or older
 * than its source, then again whenever a recorded file changes.
 *
 * @param {object} options
 * @param {string} options.outDir     The build's output folder, holding its `build-inputs.json`.
 * @param {string} options.repoRoot   What the record's paths are relative to.
 * @param {() => Promise<unknown>} options.build  Runs one build to its end.
 * @param {number} [options.debounceMs]  How long a burst of saves is waited out before building.
 * @returns {{ close(): void }}
 */
export function rebuildOnChange({ outDir, repoRoot, build, debounceMs = 200 }) {
  /** @type {Map<string, import("node:fs").FSWatcher>} */
  const watchers = new Map();
  /** @type {Set<string>} */
  let files = new Set();
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  let running = false;
  let again = false;
  let closed = false;

  const schedule = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), debounceMs);
  };

  // Watches the folders of the files the last build recorded. With no record
  // (a failed build empties its output), the previous set stays watched, so
  // the save that fixes the failure still rebuilds.
  const rewatch = () => {
    const inputs = recordedInputs(outDir, repoRoot);
    if (inputs === undefined) return;
    files = new Set(inputs);
    const dirs = new Set(inputs.map((file) => dirname(file)));
    for (const [dir, watcher] of watchers) {
      if (dirs.has(dir)) continue;
      watcher.close();
      watchers.delete(dir);
    }
    for (const dir of dirs) {
      if (watchers.has(dir)) continue;
      try {
        // A folder, not each file: editors that save by renaming a new file over the old one are seen too.
        const watcher = watch(dir, (_event, name) => {
          if (name !== null && files.has(join(dir, String(name)))) schedule();
        });
        watcher.on("error", () => {});
        watchers.set(dir, watcher);
      } catch {
        // A folder that is gone: the next build's record says what to watch.
      }
    }
  };

  const run = async () => {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await build();
    } finally {
      running = false;
    }
    rewatch();
    if (again) {
      again = false;
      void run();
    }
  };

  rewatch();
  if (staleBuildInputs(outDir, repoRoot) !== undefined) void run();

  return {
    close() {
      closed = true;
      clearTimeout(timer);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}
