#!/usr/bin/env node
/**
 * The packed-install check: what a consumer who installs FSD from npm gets.
 *
 * Every test in the repository resolves packages through `src/*.ts` over a
 * workspace link. A published package is something else: a tarball with only
 * `dist`, its `publishConfig` fields swapped in, its `workspace:` ranges
 * rewritten, installed by npm into someone else's project. 0.1.1 passed every
 * source test and `publint`, and failed on its first import. This check runs
 * the consumer's path instead:
 *
 *   1. pack every publishable package under `packages/` with pnpm (the same
 *      packer `changeset publish` uses), after `pnpm release:build`;
 *   2. `npm install` all the tarballs, in one call, into an empty ESM project,
 *      so each package's workspace dependencies resolve to the tarball beside
 *      it and not to the last version on the registry;
 *   3. run each check in {@link CHECKS} against that project: the installed
 *      copies are the packed ones, every entry point imports, a server starts
 *      and answers an action, and DevTool serves its client assets.
 *
 * `--control` runs the same install and import path against the published
 * `@flow-state-dev/core@0.1.1` tarball, pinned by its integrity hash, and
 * exits 0 only if it fails the way 0.1.1 is known to fail: `ERR_MODULE_NOT_FOUND`
 * on a relative import inside `dist`. A control that passes, or fails for any
 * other reason (a network error, a missing package), is a red step, because a
 * check never seen to fail proves nothing. It is pinned rather than "the latest
 * release" because the latest release stops failing the moment a good one ships.
 *
 * **Adding a check.** Append to {@link CHECKS}: `{ name, run(project) }`, where
 * `run` returns a list of failure strings (empty on pass). `project` carries the
 * consumer directory and the packed packages with their manifests. Checks run
 * against the installed copy only; never import from the repository.
 *
 * Usage: `node scripts/packed-install/run.mjs [--control] [--keep]`.
 * `--keep` leaves the temporary project on disk and prints its path.
 * Needs network access to the npm registry for third-party dependencies.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { publishableDists } from "../add-esm-extensions.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const PACKAGES = join(ROOT, "packages");
const FIXTURES = new URL("./fixtures", import.meta.url).pathname;

/**
 * The control: the first published core, which shipped extensionless relative
 * imports. Pinned by content, so a republish under the same version (npm
 * forbids it, but a mirror might not) cannot quietly turn the control green.
 */
export const CONTROL = {
  spec: "@flow-state-dev/core@0.1.1",
  name: "@flow-state-dev/core",
  integrity:
    "sha512-PeOUBikYvtb1L9U3WY0oTf3wXJAXOzbBbrQ56hxSjS62dJyjqV1UcE8aTQ5Rnaw+rrUxQhy2Q8Ez3jVQGPK1jw==",
};

const log = (msg) => console.log(msg);

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * The import specifiers a consumer can write for one package: `name` plus
 * every concrete subpath export whose target is JavaScript. Wildcard subpaths
 * (`./items/*`) name no single file and non-JS targets (`./styles.css`) are not
 * imported by Node, so both are returned separately as `skipped`.
 *
 * Exported so a test can pin the rules against fixture manifests.
 *
 * @param {{ name: string, exports?: unknown, publishConfig?: { exports?: unknown } }} manifest
 */
export function importSpecifiers(manifest) {
  const exp = manifest.publishConfig?.exports ?? manifest.exports;
  if (exp == null || typeof exp === "string") {
    return { specs: [manifest.name], skipped: [] };
  }
  const keys = Object.keys(exp);
  // A conditions-only map (`{ import, types }`) is the root entry.
  if (!keys.some((k) => k.startsWith("."))) {
    return { specs: [manifest.name], skipped: [] };
  }
  const specs = [];
  const skipped = [];
  for (const key of keys) {
    const spec = key === "." ? manifest.name : `${manifest.name}/${key.slice(2)}`;
    const target = resolveTarget(exp[key]);
    if (key.includes("*")) skipped.push({ spec, reason: "wildcard subpath" });
    else if (target == null || !/\.(m?js|cjs)$/.test(target))
      skipped.push({ spec, reason: `not a JavaScript entry (${target})` });
    else specs.push(spec);
  }
  return { specs, skipped };
}

/** The file Node's ESM resolver would load for one `exports` entry. */
function resolveTarget(entry) {
  if (typeof entry === "string") return entry;
  if (entry == null || typeof entry !== "object") return null;
  for (const cond of ["node", "import", "default"]) {
    if (cond in entry) return resolveTarget(entry[cond]);
  }
  return null;
}

/**
 * Classify one import result. A failure is acceptable only on a subpath, and
 * only when the missing module is an optional peer the package itself declares:
 * a consumer who uses that subpath installs it, and one who doesn't never loads
 * it. A package's root entry must import with no optional peer installed.
 * Everything else, and in particular a relative file inside `dist`, is a failure.
 *
 * @returns {"ok" | "optional-peer" | "fail"}
 */
export function classifyImport(result, manifest) {
  if (result.ok) return "ok";
  if (result.spec === manifest.name) return "fail";
  const missing = /Cannot find package '([^']+)'/.exec(result.message ?? "")?.[1];
  const optional = Object.entries(manifest.peerDependenciesMeta ?? {})
    .filter(([, meta]) => meta?.optional)
    .map(([name]) => name);
  if (result.code === "ERR_MODULE_NOT_FOUND" && missing && optional.includes(missing))
    return "optional-peer";
  return "fail";
}

/**
 * True when an import resolved and linked every static import in its graph,
 * even if evaluating it then threw.
 *
 * Node's ESM loader resolves and links the entire static graph before running
 * any of it, so a missing file, an unexported subpath or a missing named export
 * all fail before evaluation, as a `SyntaxError` or an `ERR_*` code. An error
 * with neither was thrown by the module's own code. That matters for subpaths
 * built to load inside a test runner: `@flow-state-dev/engine/testing` imports
 * `vitest`, which throws on evaluation outside a vitest run, and its packaging
 * is still sound. Used only after the owning package's optional peer is
 * installed; a root entry has to import outright.
 */
export function resolvedGraph(result) {
  if (result.ok) return true;
  return result.name !== "SyntaxError" && !String(result.code ?? "").startsWith("ERR_");
}

/**
 * Checks run, in order, against the installed consumer project. Each returns
 * the failures it found; an empty list is a pass.
 *
 * @type {{ name: string, run: (project: Project) => string[] }[]}
 */
export const CHECKS = [
  {
    // Every tarball the check packed is the copy the consumer loads. npm pulls
    // a registry version instead when a packed version doesn't satisfy a
    // sibling's range, and then every later check is testing the wrong code.
    name: "installed copies are the packed tarballs",
    run(project) {
      const failures = [];
      for (const pkg of project.packages) {
        const installed = join(project.dir, "node_modules", pkg.name, "package.json");
        if (!existsSync(installed)) {
          failures.push(`${pkg.name}: not installed at the top level`);
          continue;
        }
        const version = JSON.parse(readFileSync(installed, "utf8")).version;
        if (version !== pkg.manifest.version)
          failures.push(`${pkg.name}: installed ${version}, packed ${pkg.manifest.version}`);
      }
      for (const nested of nestedScopedCopies(join(project.dir, "node_modules")))
        failures.push(`nested registry copy at ${nested}`);
      return failures;
    },
  },
  {
    name: "every package imports",
    run(project) {
      const failures = [];
      const byName = new Map(project.packages.map((p) => [p.name, p]));
      const specs = project.packages.flatMap((p) => importSpecifiers(p.manifest).specs);
      const needPeer = new Map(); // spec → "peer@range"
      for (const result of importEach(project.dir, specs)) {
        const owner = byName.get(ownerOf(result.spec));
        const verdict = classifyImport(result, owner.manifest);
        if (verdict === "ok") continue;
        if (verdict === "optional-peer") {
          const peer = /Cannot find package '([^']+)'/.exec(result.message)[1];
          needPeer.set(result.spec, `${peer}@${owner.manifest.peerDependencies?.[peer] ?? "latest"}`);
          continue;
        }
        failures.push(`${result.spec}: ${result.code ?? "error"} ${result.message}`);
      }
      // A subpath excused for a missing optional peer is not excused from
      // loading: install the peers, as a consumer of that subpath would, and
      // import those subpaths again. They must now resolve their whole graph.
      if (needPeer.size > 0) {
        const peers = [...new Set(needPeer.values())];
        log(`    installing optional peer(s) ${peers.join(", ")} for ${needPeer.size} subpath(s)`);
        npmInstall(project.dir, peers);
        for (const result of importEach(project.dir, [...needPeer.keys()])) {
          if (resolvedGraph(result)) {
            if (!result.ok) log(`    ${result.spec}: resolved; threw on evaluation (${result.message})`);
            continue;
          }
          failures.push(`${result.spec} (with ${needPeer.get(result.spec)}): ${result.code ?? "error"} ${result.message}`);
        }
      }
      log(`    ${specs.length} entry point(s) across ${project.packages.length} package(s)`);
      return failures;
    },
  },
  {
    name: "a server starts and answers an action",
    run: (project) => runFixture(project, "serve.mjs", "serve"),
  },
  {
    // `pnpm pack` skips prepublishOnly, so a missing dist-client still packs and still imports.
    name: "DevTool serves its client assets from the installed copy",
    run: (project) => runFixture(project, "serve-devtool.mjs", "devtool"),
  },
];

/** `@scope/name/sub` → `@scope/name`. */
function ownerOf(spec) {
  return spec.split("/").slice(0, 2).join("/");
}

/** Any `@flow-state-dev/*` package installed below the top level. */
function nestedScopedCopies(nodeModules) {
  const found = [];
  const visit = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = join(dir, e.name);
      if (e.name === "node_modules") {
        if (existsSync(join(full, "@flow-state-dev"))) found.push(join(full, "@flow-state-dev"));
        visit(full, depth + 1);
      } else if (depth < 6) visit(full, depth + 1);
    }
  };
  visit(nodeModules, 0);
  return found;
}

/**
 * Copy one fixture into the consumer project and run it. `stem` is its
 * verdict prefix (`serve`, `devtool`). The engine logs freely to stderr; the
 * fixture's `${stem}: FAIL` line, or the tail of a crash, names the failure.
 */
function runFixture(project, file, stem) {
  copyFileSync(join(FIXTURES, file), join(project.dir, file));
  const res = spawnSync(process.execPath, [file], {
    cwd: project.dir,
    encoding: "utf8",
    timeout: 60_000,
  });
  const stdout = res.stdout ?? "";
  const ok = `${stem}: ok`;
  if (res.status === 0 && stdout.includes(ok)) {
    const detail = stdout.trim().split("\n").pop();
    if (detail !== ok) log(`    ${detail}`);
    return [];
  }
  const out = `${res.stderr ?? ""}\n${stdout}`;
  const verdict = out.split("\n").find((l) => l.startsWith(`${stem}: FAIL`));
  return [`exit ${res.status ?? res.signal}: ${verdict ?? out.trim().slice(-800)}`];
}

/** Import each specifier inside the consumer project; one result per spec. */
function importEach(dir, specs) {
  copyFileSync(join(FIXTURES, "import-each.mjs"), join(dir, "import-each.mjs"));
  const res = spawnSync(process.execPath, ["import-each.mjs", ...specs], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const results = res.stdout
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l));
  // A crash mid-run (a module that kills the process) leaves specs unreported.
  const seen = new Set(results.map((r) => r.spec));
  for (const spec of specs)
    if (!seen.has(spec))
      results.push({ spec, ok: false, code: "NOT_REACHED", message: res.stderr.trim().slice(0, 300) });
  return results;
}

/** An empty ESM consumer project. */
function emptyProject() {
  const dir = mkdtempSync(join(tmpdir(), "fsd-packed-install-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "fsd-packed-install", private: true, type: "module" }, null, 2),
  );
  return dir;
}

function npmInstall(dir, specs) {
  sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", ...specs], dir);
}

/**
 * Pack every publishable workspace package into `dest`.
 * @returns {{ name: string, dir: string, tarball: string, manifest: object }[]}
 */
function packAll(dest) {
  const dirs = readdirSync(PACKAGES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(PACKAGES, e.name, "package.json")))
    .map((e) => e.name);
  const read = (d) => JSON.parse(readFileSync(join(PACKAGES, d, "package.json"), "utf8"));
  return publishableDists(dirs, read).map((d) => {
    const before = new Set(readdirSync(dest));
    sh("pnpm", ["--dir", join(PACKAGES, d), "pack", "--pack-destination", dest], ROOT);
    const tarball = readdirSync(dest).find((f) => !before.has(f));
    if (!tarball) throw new Error(`pnpm pack produced no tarball for packages/${d}`);
    const manifest = JSON.parse(
      sh("tar", ["xzOf", join(dest, tarball), "package/package.json"], ROOT),
    );
    return { name: manifest.name, dir: d, tarball: join(dest, tarball), manifest };
  });
}

/**
 * @typedef {{ dir: string, packages: { name: string, manifest: object }[] }} Project
 */

function runChecks(project, checks) {
  let failed = 0;
  for (const check of checks) {
    log(`\n• ${check.name}`);
    const failures = check.run(project);
    if (failures.length === 0) {
      log("  ✓ pass");
      continue;
    }
    failed += 1;
    log(`  ✗ ${failures.length} failure(s):`);
    for (const f of failures) log(`    ${f}`);
  }
  return failed;
}

function main() {
  const control = process.argv.includes("--control");
  const keep = process.argv.includes("--keep");
  const work = mkdtempSync(join(tmpdir(), "fsd-packed-tarballs-"));
  const dir = emptyProject();
  try {
    if (control) return runControl(work, dir);

    log("packing publishable packages…");
    const packed = packAll(work);
    log(`  ${packed.length} tarball(s)`);
    log("installing into an empty ESM project…");
    npmInstall(dir, packed.map((p) => p.tarball));
    const failed = runChecks({ dir, packages: packed }, CHECKS);
    if (failed > 0) {
      log(`\n✗ packed install: ${failed} of ${CHECKS.length} check(s) failed`);
      return 1;
    }
    log(`\n✓ packed install: ${CHECKS.length} check(s) passed on ${packed.length} package(s)`);
    return 0;
  } finally {
    if (keep) log(`\nproject kept at ${dir}`);
    else rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The control must fail, and fail for the 0.1.1 reason. Returns 0 when it does.
 */
function runControl(work, dir) {
  log(`control: fetching ${CONTROL.spec}…`);
  const file = sh("npm", ["pack", CONTROL.spec, "--pack-destination", work, "--silent"], work)
    .trim()
    .split("\n")
    .pop();
  const tarball = join(work, file);
  const integrity = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
  if (integrity !== CONTROL.integrity) {
    log(`✗ control tarball is not the pinned 0.1.1 bytes (got ${integrity})`);
    return 1;
  }
  npmInstall(dir, [tarball]);
  const manifest = JSON.parse(
    readFileSync(join(dir, "node_modules", CONTROL.name, "package.json"), "utf8"),
  );
  const importCheck = CHECKS.find((c) => c.name === "every package imports");
  const project = { dir, packages: [{ name: CONTROL.name, manifest }] };
  const specs = importSpecifiers(manifest).specs;
  const results = importEach(dir, specs);
  const expected = results.filter(
    (r) => !r.ok && r.code === "ERR_MODULE_NOT_FOUND" && /\/dist\/.*imported from .*\/dist\//.test(r.message),
  );
  const failed = runChecks(project, [importCheck]);
  if (failed > 0 && expected.length > 0) {
    log(`\n✓ control failed as it must: ${expected.length} entry point(s) hit an extensionless relative import`);
    log(`    e.g. ${expected[0].spec}: ${expected[0].message}`);
    return 0;
  }
  log(
    failed === 0
      ? `\n✗ control PASSED against ${CONTROL.spec}; this check can no longer see the 0.1.1 defect`
      : `\n✗ control failed, but not on an extensionless relative import in dist; fix the check before trusting it`,
  );
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main());
}
