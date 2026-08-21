/**
 * Resolutions 1–3: the workspace root, the write root, and the package manager.
 *
 * These come first because everything else is relative to one of them, and because "the project
 * root" is two different directories in an ordinary monorepo. In a pnpm/npm/Yarn workspace the
 * app's manifest sits at `apps/web/package.json` while the lockfile and the `packageManager`
 * field sit at the repository root — so a root-only search reports the manager `undeclared`, and
 * a repository-root search reports the host `node` and would scaffold at the top of somebody's
 * monorepo. Neither is an edge case.
 */
import { join as joinPath } from "node:path";
import { existsSync as exists } from "node:fs";
import { LOCKFILES, SUPPORTED_PACKAGE_MANAGERS } from "./constants.mjs";
import { ancestorsFrom, isProjectDir, listDir, readManifest, repositoryRoot } from "./fs-util.mjs";

/** Does this directory *declare* a workspace? A lockfile does not; it is residue that can sit anywhere. */
export function declaresWorkspace(dir) {
  if (exists(joinPath(dir, "pnpm-workspace.yaml")) || exists(joinPath(dir, "pnpm-workspace.yml"))) {
    return { declares: true, via: "pnpm-workspace.yaml" };
  }
  const manifest = readManifest(dir);
  if (manifest !== null && Array.isArray(manifest.workspaces) && manifest.workspaces.length > 0) {
    return { declares: true, via: "workspaces in package.json" };
  }
  if (manifest !== null && Array.isArray(manifest.workspaces?.packages)) {
    return { declares: true, via: "workspaces.packages in package.json" };
  }
  return { declares: false, via: null };
}

/**
 * Resolution 1 — the workspace root: the **outermost** ancestor declaring a workspace, else the
 * repository root, else the write root.
 *
 * Outermost, not nearest, and bounded by a workspace *declaration* rather than by the nearest
 * package-manager signal. Bounding it on a lockfile is what let a stale `package-lock.json`
 * beside an app make that app its own workspace root — the search then never travelled far enough
 * to see the root's `packageManager: pnpm`, resolved npm, and installed through the wrong manager.
 */
export function resolveWorkspaceRoot(writeRoot) {
  // **Bounded by the repository.** A workspace cannot span repositories, so the search stops at
  // the repository root that owns the write root. Without this bound a project that happens to
  // sit inside an unrelated checkout — vendored, or a fixture under someone else's monorepo —
  // inherits that repository's `pnpm-workspace.yaml`, and resolution 3 then reads a
  // `packageManager` declaration belonging to a project the developer has nothing to do with.
  // Found by running detection on a real path rather than on a fixture.
  const repo = repositoryRoot(writeRoot);
  let outermost = null;
  let via = null;
  for (const dir of ancestorsFrom(writeRoot)) {
    const declaration = declaresWorkspace(dir);
    if (declaration.declares) {
      outermost = dir;
      via = declaration.via;
    }
    if (repo !== null && dir === repo) break;
  }
  if (outermost !== null) return { path: outermost, source: via };

  if (repo !== null) return { path: repo, source: "the git repository root" };
  return { path: writeRoot, source: "the write root itself (no workspace and no repository)" };
}

/**
 * Project directories beneath `dir` — what makes a container a container.
 *
 * **Bounded by depth, and the bound is declared rather than accidental.** A hand-unrolled
 * two-level walk missed `packages/group/app/package.json`, so a workspace nested one level deeper
 * than the shapes I happened to think of evaded the container refusal and reported as a plain
 * Node host — the second-process setup then scaffolds at the top of the repository. Depth is a
 * real limit (this is a look, not a search), so it is a named constant with a test at the
 * boundary rather than a loop shape nobody can see.
 */
export const CONTAINER_SCAN_DEPTH = 4;

export function childProjects(dir, depth = CONTAINER_SCAN_DEPTH) {
  const found = [];
  const walk = (current, remaining) => {
    if (remaining === 0) return;
    for (const entry of listDir(current)) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const child = joinPath(current, entry.name);
      if (isProjectDir(child)) {
        found.push(child);
        // A project's own subdirectories are its business, not more members of the container.
        continue;
      }
      walk(child, remaining - 1);
    }
  };
  walk(dir, depth);
  return found;
}

/**
 * Every `packageManager` field and every lockfile in the write-root→workspace-root chain, nearest
 * first. Both lists are reported, because "your lockfile changed" is different news when the
 * lockfile is two directories above the app the developer was working in.
 */
export function collectManagerSignals(writeRoot, workspaceRoot) {
  const chain = [];
  for (const dir of ancestorsFrom(writeRoot)) {
    chain.push(dir);
    if (dir === workspaceRoot) break;
  }
  // A workspace root that is not an ancestor (it never is, but the chain is data) still bounds nothing.
  const fields = [];
  const lockfiles = [];
  for (const dir of chain) {
    const manifest = readManifest(dir);
    if (typeof manifest?.packageManager === "string" && manifest.packageManager.length > 0) {
      fields.push({ dir, value: manifest.packageManager, manager: manifest.packageManager.split("@")[0] });
    }
    for (const [name, manager] of Object.entries(LOCKFILES)) {
      if (exists(joinPath(dir, name))) lockfiles.push({ dir, name, manager, path: joinPath(dir, name) });
    }
  }
  return { chain, fields, lockfiles };
}

/**
 * Resolution 3 — the package manager, decided by one precedence pass over the **whole** chain.
 *
 * Not nearest-signal-first, which is the ordering that let a stale lockfile win:
 *   1. Any `packageManager` field anywhere in the chain beats every lockfile anywhere in it. It
 *      is the only *declaration* among these signals and corepack enforces it. Among fields the
 *      nearest wins — an app may legitimately override its workspace.
 *   2. With no field anywhere, lockfiles across the chain decide. All pointing at one manager →
 *      that manager. Disagreeing, or two at one level → `ambiguous`.
 *   3. Nothing anywhere → `undeclared`.
 *
 * There is no third source. `npm_config_user_agent` describes how *our own script* was launched,
 * not what the project uses — and the scripts are invoked from an installed plugin, so no npm
 * process wraps them and the variable is normally absent anyway. Defaulting to npm on its
 * strength writes a `package-lock.json` into a project that never asked for one.
 */
export function resolvePackageManager(writeRoot, workspaceRoot) {
  const { fields, lockfiles } = collectManagerSignals(writeRoot, workspaceRoot);
  const evidence = {
    fields: fields.map((f) => ({ path: joinPath(f.dir, "package.json"), value: f.value })),
    lockfiles: lockfiles.map((l) => ({ path: l.path, manager: l.manager })),
  };

  if (fields.length > 0) {
    const nearest = fields[0];
    const ignoring = lockfiles
      .filter((l) => l.manager !== nearest.manager)
      .map((l) => l.path);
    if (!SUPPORTED_PACKAGE_MANAGERS.includes(nearest.manager)) {
      return {
        value: "unsupported",
        manager: nearest.manager,
        source: `the packageManager field in ${joinPath(nearest.dir, "package.json")}`,
        ignoringLockfiles: ignoring,
        ...evidence,
      };
    }
    return {
      value: nearest.manager,
      manager: nearest.manager,
      source: `the packageManager field in ${joinPath(nearest.dir, "package.json")}`,
      ignoringLockfiles: ignoring,
      ...evidence,
    };
  }

  if (lockfiles.length === 0) {
    return { value: "undeclared", manager: null, source: null, ignoringLockfiles: [], ...evidence };
  }

  // Disagreement is what makes lockfiles undecidable, not their count. Two lockfiles in the chain
  // that both evidence the same manager (a workspace root's and its app's, or a
  // `package-lock.json` beside an `npm-shrinkwrap.json`) resolve cleanly; refusing them would
  // reject an ordinary layout over a signal that agrees with itself.
  const managers = new Set(lockfiles.map((l) => l.manager));
  if (managers.size > 1) {
    return { value: "ambiguous", manager: null, source: null, ignoringLockfiles: [], ...evidence };
  }

  const [manager] = [...managers];
  const nearest = lockfiles[0];
  if (!SUPPORTED_PACKAGE_MANAGERS.includes(manager)) {
    return { value: "unsupported", manager, source: nearest.path, ignoringLockfiles: [], ...evidence };
  }
  return { value: manager, manager, source: nearest.path, ignoringLockfiles: [], ...evidence };
}
