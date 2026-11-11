/**
 * Records the files a lab's server loaded, so the super app can tell when its
 * server code changed since it started.
 *
 * A lab's pages are rebuilt as their source changes (`rebuild.mjs`), but its
 * server loads its flows, config and package source once, at start. This is a
 * preload on the server step (`tsx --import <this file> …`): every module the
 * process loads from this repository, outside `node_modules`, is hashed as it
 * loads and written to `build-inputs.json` in the folder named by
 * `SUPER_APP_SERVER_INPUTS`. That is the page builds' record shape, so
 * `staleBuildInputs()` (`scripts/build-inputs.mjs`) answers "changed since
 * start" the same way it answers "page older than its source".
 *
 * What is recorded is what the server loaded, not a folder: a lab's page
 * components live beside its flows, and the server never loads them.
 *
 * ES modules are seen through a module load hook, which runs alongside tsx's
 * own. tsx compiles CommonJS through its own require path, which skips that
 * hook, so `require.cache` is read too. A module loaded late (a flow imported
 * on first use) joins the record when it loads.
 *
 * The variable is removed from the environment once read, so a process the
 * lab starts (a coding agent, say) doesn't record into the same file.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_INPUTS_FILE } from "../../scripts/build-inputs.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const outDir = process.env.SUPER_APP_SERVER_INPUTS;
delete process.env.SUPER_APP_SERVER_INPUTS;

if (outDir !== undefined && outDir !== "") {
  /** Repo-relative path to the hash of its content when it loaded. */
  const inputs = {};
  const cache = createRequire(import.meta.url).cache;
  /** @type {NodeJS.Timeout | undefined} */
  let timer;

  const add = (file) => {
    if (!isAbsolute(file) || file.includes(`${sep}node_modules${sep}`)) return false;
    const path = relative(REPO, file);
    if (path.startsWith("..")) return false;
    const key = path.split(sep).join("/");
    if (key in inputs) return false;
    try {
      inputs[key] = createHash("sha256").update(readFileSync(file)).digest("hex");
      return true;
    } catch {
      // Not a file on disk (a virtual module): nothing to compare later.
      return false;
    }
  };

  const write = () => {
    timer = undefined;
    for (const file of Object.keys(cache)) add(file);
    mkdirSync(outDir, { recursive: true });
    // Written beside and renamed over, so a reader never sees half a record.
    const record = join(outDir, BUILD_INPUTS_FILE);
    writeFileSync(`${record}.tmp`, `${JSON.stringify({ inputs }, null, 2)}\n`);
    renameSync(`${record}.tmp`, record);
  };
  const schedule = () => {
    timer ??= setTimeout(write, 200);
  };

  registerHooks({
    load(url, context, nextLoad) {
      if (url.startsWith("file:") && add(fileURLToPath(url))) schedule();
      return nextLoad(url, context);
    },
  });
  // CommonJS loads don't pass the hook: pick up what `require.cache` gained.
  setInterval(() => {
    const before = Object.keys(inputs).length;
    for (const file of Object.keys(cache)) add(file);
    if (Object.keys(inputs).length !== before) schedule();
  }, 2000).unref();
}
