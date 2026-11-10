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
import { watch } from "node:fs";
import { dirname, join } from "node:path";
import { BUILD_INPUTS_FILE, recordedInputPaths, staleBuildInputs } from "../../scripts/build-inputs.mjs";

/** One line on stderr for a folder that can't be watched, so edits there not rebuilding has a cause. */
const warnUnwatched = (dir, error) =>
  process.stderr.write(`[rebuild] can't watch ${dir}, so saves there won't rebuild: ${error?.message ?? error}\n`);

/**
 * Why the build in `outDir` is behind its source, or `undefined` when it isn't. A record that can't be read
 * (a build writing it right now) counts as behind: the build that follows rewrites it.
 *
 * @param {string} outDir
 * @param {string} repoRoot
 * @returns {string | undefined}
 */
function changeOf(outDir, repoRoot) {
  try {
    return staleBuildInputs(outDir, repoRoot);
  } catch (error) {
    return `its ${BUILD_INPUTS_FILE} can't be read: ${error?.message ?? error}`;
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

  // With no record (a page never built, or a build that failed, perhaps on a
  // module it newly imports that no record names), any save in a watched
  // folder builds, and the page's own folder and its `src/` are watched too,
  // so the save that fixes it is seen. Back to recorded files only once a
  // build records its inputs.
  let unrecorded = false;
  const page = dirname(outDir);
  /** @type {import("node:fs").FSWatcher[]} */
  let fallback = [];
  const watchFallback = () => {
    if (fallback.length > 0) return;
    for (const [dir, recursive] of [[page, false], [join(page, "src"), true]]) {
      try {
        const watcher = watch(dir, { recursive }, (_event, name) => {
          if (name !== null && !join(dir, String(name)).startsWith(outDir)) schedule();
        });
        watcher.on("error", (error) => warnUnwatched(dir, error));
        fallback.push(watcher);
      } catch (error) {
        // No `src/`: the page folder alone.
        if (error?.code !== "ENOENT") warnUnwatched(dir, error);
      }
    }
  };

  // Watches the folders of the files the last build recorded. With no record,
  // the previous set stays watched beside the fallback.
  const rewatch = () => {
    const inputs = recordedInputPaths(outDir, repoRoot);
    unrecorded = inputs === undefined;
    if (inputs === undefined) {
      watchFallback();
      return;
    }
    for (const watcher of fallback) watcher.close();
    fallback = [];
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
          if (name !== null && (unrecorded || files.has(join(dir, String(name))))) schedule();
        });
        watcher.on("error", (error) => warnUnwatched(dir, error));
        watchers.set(dir, watcher);
      } catch (error) {
        // A folder that is gone: the next build's record says what to watch.
        if (error?.code !== "ENOENT") warnUnwatched(dir, error);
      }
    }
  };

  const run = async () => {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    // A write that left every recorded file's content as it was isn't a change: an editor's rewrite, or a
    // late watch event from an earlier save (macOS delivers them after the watcher starts). Each would
    // otherwise start a build of 20 seconds or so that bundles exactly what the last one did.
    if (changeOf(outDir, repoRoot) === undefined) return;
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
      for (const watcher of [...watchers.values(), ...fallback]) watcher.close();
      watchers.clear();
      fallback = [];
    },
  };
}
