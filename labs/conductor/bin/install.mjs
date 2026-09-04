/**
 * Put `conductor` on PATH so a product checkout can run it like `grok`.
 *
 * The bin still fills `CONDUCTOR_CONFIG` and `CONDUCTOR_REPO=.`. The
 * config door still refuses the dispatcher. This only writes a symlink.
 */
import { lstatSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";

/**
 * @param {readonly string[]} args
 */
export function isConductorBinInstall(args) {
  return args.length === 1 && args[0] === "install";
}

/**
 * @param {string} home
 */
export function conductorHomeBin(home) {
  return path.join(home, ".local", "bin", "conductor");
}

/**
 * @param {string} dest
 * @param {string | undefined} pathEnv
 */
export function pathHasDir(dest, pathEnv) {
  const dir = path.dirname(dest);
  return (pathEnv ?? "").split(path.delimiter).some((entry) => entry === dir);
}

/**
 * @param {string} binPath
 * @param {NodeJS.ProcessEnv} env
 */
export function installConductorOnPath(binPath, env) {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  if (!home) {
    throw new Error("conductor: HOME is unset; cannot install to ~/.local/bin");
  }
  const dest = conductorHomeBin(home);
  mkdirSync(path.dirname(dest), { recursive: true });
  try {
    const st = lstatSync(dest);
    if (!st.isSymbolicLink()) {
      throw new Error(`conductor: ${dest} exists and is not a symlink`);
    }
    unlinkSync(dest);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== "ENOENT") throw err;
  }
  symlinkSync(path.resolve(binPath), dest);
  return dest;
}
