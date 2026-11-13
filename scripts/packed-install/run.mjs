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
 *      and answers an action, DevTool serves its client assets, and Shift
 *      Manager's installed command serves its pages beside a Lab;
 *   4. run the shared two-users-one-tenant HTTP suite against those installed
 *      copies, with a real Redis for its queue case (`suite.mjs` owns how).
 *
 * `--control` runs the same install and import path against the published
 * `@flow-state-dev/core@0.1.1` tarball, pinned by its integrity hash, and
 * exits 0 only if it fails the way 0.1.1 is known to fail: `ERR_MODULE_NOT_FOUND`
 * on a relative import inside `dist`. A control that passes, or fails for any
 * other reason (a network error, a missing package), is a red step, because a
 * check never seen to fail proves nothing. It is pinned rather than "the latest
 * release" because the latest release stops failing the moment a good one ships.
 *
 * `--control=workspace-link` packs and installs as above, swaps the installed
 * {@link LINK_CONTROL} for a symlink to its repository directory, and runs the
 * suite check. It exits 0 only if the suite's resolution guard names that
 * package: a guard never seen to fail could be reading a repository copy and
 * calling it the install.
 *
 * `--goal` is the epic's adopter goal, not a gate: the same pack and install,
 * then {@link GOAL_CHECKS} (one entry per assertion in `goal-manifest.json`)
 * through the same `runChecks`, judged by `goal.mjs` against the manifest's
 * expectations. It prints how many of the rows (the epic's six, then the closure's) hold, and exits 0 when every
 * outcome matches its expectation and none is an `error`. It runs in its own
 * workflow (`adopter-goal.yml`), on pushes to `main` and by dispatch, never on a
 * PR, because most assertions are expected to fail until their child lands.
 *
 * `--control=adopter-goal` runs {@link GOAL_CHECKS} against the published
 * tarballs the manifest pins by integrity (every package as npm served it on
 * the day of the control commit), with ratchets reading a checkout of that
 * commit. It exits 0 only when every admitted assertion reports `fail`; a
 * `pending` ratchet cell is listed, not red, until its check is wired.
 *
 * The closure row's upgrade journey (`closure.j5:moved-name-named`) installs
 * those same pinned tarballs beside the project and walks every name a package
 * root dropped since. Each package that lost one must carry the changelog line
 * counting the removed exports; the count must be the real one only on the
 * Version Packages PR (`isReleaseGrade`), and elsewhere a stale count is a
 * note. Under `--control=adopter-goal` it walks none, which is a
 * fail. `--control=moved-name` is its planted control: this checkout's
 * tarballs, with the changelog line that counts the removed exports taken out.
 * It exits 0 only when the journey then fails for every package that lost a name.
 *
 * **Adding a check.** Append to {@link CHECKS}: `{ name, run(project) }`, where
 * `run` returns a list of failure strings (empty on pass). `project` carries the
 * consumer directory and the packed packages with their manifests. Checks run
 * against the installed copy only; never import from the repository. A goal
 * check also carries its manifest `id`, may return `{ pending: reason }`, and
 * reads `project.tree` (the repository tree under test) for a ratchet. A check
 * that throws reports `error`.
 *
 * Usage: `node scripts/packed-install/run.mjs [--control | --control=workspace-link | --goal | --control=adopter-goal | --control=moved-name] [--keep]`.
 * `--keep` leaves the temporary project on disk and prints its path.
 * Needs network access to the npm registry for third-party dependencies, and
 * `REDIS_URL` pointing at a live Redis for the suite's queue case.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { publishableDists } from "../add-esm-extensions.mjs";
import {
  MOVED_RENAMES,
  changelogLines,
  formatVerdict,
  gradeMovedNames,
  isReleaseGrade,
  judge,
  judgeControl,
  outcomeOf,
  plantSummaryRemoval,
  probeNeverPublished,
  ratchetFailures,
  readManifest,
  runRatchet,
} from "./goal.mjs";
import { copyOutRecipe, EXAMPLES_README, exampleCells, exampleRun, QUICKSTART_PAGE, runQuickstart } from "./first-hour.mjs";
import { runSuite } from "./suite.mjs";
import { runVitestJson } from "./vitest-json.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const PACKAGES = join(ROOT, "packages");
const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

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

/** The package `--control=workspace-link` swaps for a link into the repository. */
export const LINK_CONTROL = "@flow-state-dev/core";

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
 * The import specifiers a consumer can write for one package: `name`, every
 * concrete subpath export whose target is JavaScript, and every file a wildcard
 * subpath (`./items/*`) reaches in the packed package. Node's `*` matches any
 * substring, `/` included, so `./items/*` → `./dist/items/*.js` also reaches
 * `dist/items/deep/nested.js`.
 *
 * What goes unimported is returned as `skipped` with a reason, for the log:
 * a non-JS target (`./styles.css`, which Node doesn't import) and a wildcard
 * that matches no packed file, which is a public subpath with nothing behind it.
 *
 * Exported so a test can pin the rules against fixture manifests.
 *
 * @param {{ name: string, exports?: unknown, publishConfig?: { exports?: unknown } }} manifest
 * @param {string[]} files — package-relative paths of the packed package's files
 *   (`dist/items/content.js`), used to expand wildcard subpaths.
 */
export function importSpecifiers(manifest, files = []) {
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
    if (key.includes("*") && target != null && /\.(m?js|cjs)$/.test(target)) {
      const matched = expandWildcard(key, target, files).map((sub) => `${manifest.name}/${sub}`);
      if (matched.length === 0) skipped.push({ spec, reason: "wildcard matches no packed file" });
      specs.push(...matched);
    } else if (target == null || !/\.(m?js|cjs)$/.test(target))
      skipped.push({ spec, reason: `not a JavaScript entry (${target})` });
    else specs.push(spec);
  }
  return { specs, skipped };
}

/**
 * Subpaths (without `./`) a wildcard export reaches: every packed file matching
 * the target pattern, with its `*` substituted back into the key.
 */
function expandWildcard(key, target, files) {
  const escape = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const [before, after] = target.replace(/^\.\//, "").split("*");
  const pattern = new RegExp(`^${escape(before)}(.+)${escape(after)}$`);
  const out = [];
  for (const file of files) {
    const m = pattern.exec(file);
    if (m) out.push(key.slice(2).replace("*", m[1]));
  }
  return out;
}

/** Package-relative paths of every file under `dir` (an installed package). */
function packageFiles(dir, prefix = "") {
  const out = [];
  for (const e of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name !== "node_modules") out.push(...packageFiles(dir, rel));
    } else out.push(rel);
  }
  return out;
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
 * True when a failed import is the 0.1.1 defect: a relative file inside a
 * package's `dist` that Node could not find, imported from another file in
 * `dist`. The control passes only on this.
 */
export function isExtensionlessDistImport(result) {
  return (
    !result.ok &&
    result.code === "ERR_MODULE_NOT_FOUND" &&
    /Cannot find module '[^']*\/dist\/[^']*' imported from [^ ]*\/dist\//.test(result.message ?? "")
  );
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
      const { failures, needPeer, specs } = importPass(project);
      // A subpath excused for a missing optional peer is not excused from
      // loading: install the peers, as a consumer of that subpath would, and
      // import those subpaths again. They must now resolve their whole graph.
      if (needPeer.size > 0) {
        const peers = [...new Set(needPeer.values())];
        log(`    installing optional peer(s) ${peers.join(", ")} for ${needPeer.size} subpath(s)`);
        npmInstall(project.dir, peers);
        failures.push(...retryWithPeers(project.dir, needPeer));
      }
      log(`    ${specs.length} entry point(s) across ${project.packages.length} package(s)`);
      return failures;
    },
  },
  {
    // Benchmarking is reached only through its two subpaths; the testing and
    // patterns roots carry none of it, and the repo-only scanners aren't published.
    name: "benchmarking is on testing/benchmark and patterns/benchmark, not on either root",
    run: (project) => runFixture(project, "benchmark-subpaths.mjs", "benchmark-subpaths"),
  },
  {
    // An adopter unit-tests a step that waits for a person with the installed
    // testing package alone, answering it through the engine's own routes.
    name: "the installed testFlow stops on a step that waits for a person, and answers it through the engine's route",
    run: (project) => runFixture(project, "test-a-stop.mjs", "test-a-stop"),
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
  {
    // What someone who installs Shift Manager runs: its command over a Lab of
    // their own. Also reads the installed package's contents, since a tarball
    // missing its pages still packs and imports.
    name: "Shift Manager's installed command serves its pages and a Lab",
    run: (project) => runFixture(project, "shift-manager.mjs", "shift-manager"),
  },
  {
    // Legs b and c: every hole's case, asked for over HTTP as the second user,
    // against the installed copies rather than the repository's `src`.
    name: "the two-users-one-tenant suite passes against the installed copies",
    run: (project) => runSuite(project).failures,
  },
];

/**
 * Copy one fixture into the consumer project and run it there. `stem` is its
 * verdict prefix: the fixture prints `<stem>: ok` on success and
 * `<stem>: FAIL at <step>: …` otherwise. Returns the check's failures: empty
 * on pass, else the fixture's own verdict or, after a crash, the tail of its
 * output.
 */
function runFixture(project, file, stem) {
  copyFileSync(join(FIXTURES, file), join(project.dir, file));
  const res = spawnSync(process.execPath, [file], {
    cwd: project.dir,
    encoding: "utf8",
    timeout: 60_000,
  });
  const ok = (res.stdout ?? "").split("\n").find((l) => l.startsWith(`${stem}: ok`));
  if (res.status === 0 && ok) {
    log(`    ${ok}`);
    return [];
  }
  // The engine logs freely to stderr; the fixture's own verdict, or the tail
  // of a crash, is what names the failure.
  const out = `${res.stderr ?? ""}\n${res.stdout ?? ""}`;
  const verdict = out.split("\n").find((l) => l.startsWith(`${stem}: FAIL`));
  return [`exit ${res.status ?? res.signal}: ${verdict ?? out.trim().slice(-800)}`];
}

/**
 * The goal's version of {@link runFixture}: the fixture's `<stem>: ok` is a
 * pass and its `<stem>: FAIL …` line (with the indented lines after it) a
 * fail. No verdict at all (a crash, a timeout, a missing dependency) throws,
 * which `runChecks` reports as `error`, so a broken leg cannot read as an
 * expected fail.
 */
function goalFixture(project, file, stem, env = {}) {
  copyFileSync(join(FIXTURES, file), join(project.dir, file));
  const res = spawnSync(process.execPath, [file], {
    cwd: project.dir,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, ...env },
  });
  const lines = (res.stdout ?? "").split("\n");
  if (lines.some((l) => l.startsWith(`${stem}: ok`))) return [];
  const at = lines.findIndex((l) => l.startsWith(`${stem}: FAIL`));
  if (at >= 0) {
    const rest = lines.slice(at + 1).filter((l) => l.startsWith("  ")).map((l) => l.trim());
    return [lines[at], ...rest.slice(0, 40), ...(rest.length > 40 ? [`… ${rest.length - 40} more`] : [])];
  }
  throw new Error(`${file} gave no verdict (exit ${res.status ?? res.signal}): ${`${res.stderr ?? ""}\n${res.stdout ?? ""}`.trim().slice(-800)}`);
}

/** The roots the epic owns, one `surface.root.<name>` ratchet cell each. */
const OWNED_ROOTS = [
  "core", "engine", "client", "react", "testing", "orchestration", "patterns",
  "claude-code", "codex", "cursor", "store-sqlite", "store-postgres",
];

/**
 * Ratchet cells: each reads one workspace check's strict run over
 * `project.tree` (see `runRatchet` in goal.mjs for the protocol), and reports
 * `pending` while the manifest's `ratchets` entry for that check is `null`.
 * One strict run serves every cell that reads it.
 */
const RATCHET_CELLS = [
  ...OWNED_ROOTS.map((root) => ({
    id: `surface.root.${root}`,
    name: `the export check finds nothing on @flow-state-dev/${root}'s root, baseline set aside`,
    ratchet: "export-check",
    package: `@flow-state-dev/${root}`,
  })),
  {
    id: "surface.root.workforce",
    name: "the export check finds nothing among workforce's *_ENTRY names, baseline set aside",
    ratchet: "export-check",
    package: "@flow-state-dev/workforce",
    names: /_ENTRY$/,
  },
  {
    id: "surface.collisions",
    name: "the collision check, strict over every published root, finds no two roots exporting one name for different declarations",
    ratchet: "collision-check",
    package: "*",
  },
  {
    id: "leakage.tracker-ids",
    name: "the tracker-id lint, suppressions set aside, finds nothing",
    ratchet: "tracker-id-lint",
    package: "*",
  },
];

/**
 * The examples that run with no model key: their README's `fsdev run` blocks
 * are a `run` cell each. The others name a key their runs need.
 */
const KEYLESS_EXAMPLES = new Set(["board-lifecycle", "custom-pattern", "research-team"]);

/**
 * The `first-hour.example.<name>.<step>` cells: each example under
 * `examples/`, found by a folder walk, copied out and run by the copy-out
 * recipe (`first-hour.mjs`), one cell per step. An example added later
 * reports cells the manifest does not list, which the judge refuses until
 * they are admitted. `install` is every step's prerequisite, not a cell.
 */
const FIRST_HOUR_EXAMPLE_CELLS = exampleCells(join(ROOT, "examples"), KEYLESS_EXAMPLES).map(({ name, dir, step }) => ({
  name,
  path: relative(ROOT, dir),
  step,
}));

/**
 * The copy-out recipe, read from this checkout's `examples/README.md`: the
 * reader's procedure, which the control applies to the pinned commit's
 * examples too.
 */
function recipe() {
  const readme = join(ROOT, EXAMPLES_README);
  return existsSync(readme) ? copyOutRecipe(readFileSync(readme, "utf8")) : null;
}

/** One copy-out run per example per goal run, shared by its cells. */
function exampleCopy(project, { name, path }) {
  if (!project.exampleRuns.has(name)) {
    const dir = mkdtempSync(join(tmpdir(), `fsd-first-hour-${name}-`));
    mkdirSync(join(dir, name));
    project.cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    project.exampleRuns.set(
      name,
      exampleRun({
        src: join(project.tree, path),
        dir: join(dir, name),
        recipe: recipe(),
        repoRoot: ROOT,
        tarballs: project.tarballs,
        log,
      }),
    );
  }
  return project.exampleRuns.get(name);
}

/** The TypeScript the consumer project reads core's `.d.ts` with: the workspace's own. */
const TYPESCRIPT_SPEC = "typescript@npm:@typescript/typescript6@6.0.2";

/**
 * What leg c's React fixture renders with: React and a DOM, at the versions the
 * workspace builds and tests React against. An adopter's app brings its own
 * React; the installed `@flow-state-dev/react` only peers on it.
 */
const REACT_SPECS = ["react@19.2.4", "react-dom@19.2.4", "jsdom@27.4.0"];

/** The export census's frozen list of moved core names. */
const MOVED_TSV = join(ROOT, "specs/issues/FIX-2448/poc/export-census/moved.tsv");

/**
 * The goal's checks, one per assertion in `goal-manifest.json`, run by
 * `runChecks` against the installed project. `project` also carries `tree`
 * (the repository tree ratchets read) and `manifest`.
 *
 * @type {{ id: string, name: string, run: (project: Project & { tree: string, manifest: object, ratchetRuns: Map<string, unknown> }) => string[] | { pending: string } }[]}
 */
export const GOAL_CHECKS = [
  ...RATCHET_CELLS.map((cell) => ({
    id: cell.id,
    name: cell.name,
    run(project) {
      const script = project.manifest.ratchets?.[cell.ratchet];
      if (script == null) return { pending: `${cell.ratchet} is not wired in the manifest yet` };
      if (!project.ratchetRuns.has(cell.ratchet)) {
        let run;
        try {
          run = { violations: runRatchet(ROOT, script, project.tree).violations };
        } catch (err) {
          run = { error: err };
        }
        project.ratchetRuns.set(cell.ratchet, run);
      }
      const run = project.ratchetRuns.get(cell.ratchet);
      if (run.error) throw run.error;
      return ratchetFailures(run.violations, cell);
    },
  })),
  {
    id: "surface.core-installed-dts",
    name: "installed core's .d.ts: no moved name on the root or core/types, each on its entry, no requestHost or symbol-keyed member on BlockContext, no compiled test file in the tarball",
    run(project) {
      npmInstall(project.dir, [TYPESCRIPT_SPEC]);
      const installed = join(project.dir, "node_modules", "@flow-state-dev/core");
      const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
      const { specs } = importSpecifiers(manifest, packageFiles(installed));
      return goalFixture(project, "goal-core-dts.mjs", "core-dts", {
        FSD_MOVED_TSV: MOVED_TSV,
        FSD_MOVED_RENAMES: JSON.stringify(MOVED_RENAMES),
        FSD_CORE_SPECS: JSON.stringify(specs),
      });
    },
  },
  {
    id: "first-hour.quickstart",
    name: "the quick start's own blocks, in order, in an empty folder, then its fsdev run returns an answer",
    run(project) {
      const dir = mkdtempSync(join(tmpdir(), "fsd-first-hour-quickstart-"));
      mkdirSync(join(dir, "app"));
      try {
        return runQuickstart({
          markdown: readFileSync(join(project.tree, QUICKSTART_PAGE), "utf8"),
          dir: join(dir, "app"),
          repoRoot: ROOT,
          tarballs: project.tarballs,
          log,
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  ...FIRST_HOUR_EXAMPLE_CELLS.map((cell) => ({
    id: `first-hour.example.${cell.name}.${cell.step}`,
    name: `${cell.path}, copied to an empty folder by the copy-out recipe: ${cell.step}`,
    run: (project) => exampleCopy(project, cell).step(cell.step),
  })),
  {
    id: "shims.never-published",
    name: "the installed packages read or refuse none of the 19 names no published version accepted",
    run: (project) => probeNeverPublished(join(project.dir, "node_modules")),
  },
  {
    id: "shims.human-approval-throws",
    name: 'ctx.suspend({ reason: "human_approval" }) throws on the installed tarballs, naming user_approval',
    run: (project) => goalFixture(project, "goal-human-approval.mjs", "human-approval"),
  },
  {
    id: "shims.stored-human-approval",
    name: "a stored human_approval suspension reads as a user's stop",
    run: (project) => goalFixture(project, "goal-stored-approval.mjs", "stored-approval"),
  },
  {
    id: "onepath.output-read",
    name: "the installed client's request(firstId).result(), under 101 newer requests, returns the computed output; a failing action resolves failed with its error.code",
    run: (project) => goalFixture(project, "goal-output-read.mjs", "output-read"),
  },
  {
    id: "types.typed-handler",
    name: "a uses: [cap] handler passes its ctx to orchestration/tasks' getOrCreateTaskCollection and compiles against the installed .d.ts with no cast",
    run(project) {
      npmInstall(project.dir, [TYPESCRIPT_SPEC]);
      return goalFixture(project, "goal-typed-handler.mjs", "typed-handler");
    },
  },
  {
    id: "types.fresh-session-default",
    name: "a fresh session reads the flow's, a block's and a capability's defaults; conflicting declarations are refused at defineFlow, naming the field and both blocks",
    run: (project) => goalFixture(project, "goal-fresh-default.mjs", "fresh-default"),
  },
  {
    id: "onepath.answer-task-stop",
    name: "installed React's useApproval, under jsdom, answers a user_approval stop raised in a task-board run",
    run(project) {
      npmInstall(project.dir, REACT_SPECS);
      return goalFixture(project, "goal-answer-task-stop.mjs", "answer-task-stop");
    },
  },
  {
    id: "closure.j5:moved-name-named",
    name: "an app importing every name a root dropped since the pinned published tarballs compiles there, fails on these name by name, and each such package's changelog says how many exports the roots lost",
    run(project) {
      const { names, lines } = movedNameJourney(project);
      const notes = [];
      const failures = gradeMovedNames(names, lines, { release: isReleaseGrade(), notes });
      if (notes.length > 0) report([`note: the summary line's count is checked at release; on this run it differs:`, ...notes.map((n) => `  ${n}`)]);
      return failures;
    },
  },
];

/**
 * The upgrade journey's input, once per goal run: the pinned published
 * tarballs (the manifest's control pins, by integrity) installed into a
 * folder of their own; the names each package root dropped between that
 * install and `project.dir`, from `goal-moved-names.mjs`; and each such
 * package's changelog lines, read from `project.tree` as the quick start is.
 *
 * @returns {{ names: { pkg: string, name: string, failsOnNew: boolean }[], lines: Map<string, string[]> }}
 */
function movedNameJourney(project) {
  if (project.movedNames) return project.movedNames;
  const pins = project.manifest.control.packages;
  const work = mkdtempSync(join(tmpdir(), "fsd-moved-names-tarballs-"));
  const old = mkdtempSync(join(tmpdir(), "fsd-moved-names-"));
  project.cleanup.push(() => rmSync(work, { recursive: true, force: true }), () => rmSync(old, { recursive: true, force: true }));
  writeFileSync(join(old, "package.json"), JSON.stringify({ name: "fsd-moved-names", private: true, type: "module" }, null, 2));
  log(`    installing the ${pins.length} pinned published tarball(s) to upgrade from…`);
  npmInstall(old, fetchPinned(work, pins));
  npmInstall(project.dir, [TYPESCRIPT_SPEC]);
  const packages = { old: pins.map((p) => p.name), new: project.packages.map((p) => p.name) };
  const { names } = goalFixtureData(project, "goal-moved-names.mjs", "moved-names", {
    FSD_J5_OLD: old,
    FSD_J5_PACKAGES: JSON.stringify(packages),
  });
  log(`    ${names.length} name(s) dropped from ${new Set(names.map((n) => n.pkg)).size} root(s)`);
  const dirs = packageDirs(project.tree);
  const changesetDir = join(project.tree, ".changeset");
  const changesets = existsSync(changesetDir)
    ? readdirSync(changesetDir)
        .filter((f) => f.endsWith(".md") && f !== "README.md")
        .map((f) => readFileSync(join(changesetDir, f), "utf8"))
    : [];
  const lines = new Map();
  for (const pkg of new Set(names.map((n) => n.pkg))) {
    const changelog = dirs.has(pkg) ? join(project.tree, "packages", dirs.get(pkg), "CHANGELOG.md") : null;
    lines.set(
      pkg,
      changelogLines(pkg, {
        changesets,
        changelog: changelog && existsSync(changelog) ? readFileSync(changelog, "utf8") : null,
        since: pins.find((p) => p.name === pkg).version,
      }),
    );
  }
  project.movedNames = { names, lines };
  return project.movedNames;
}

/** Package name → its folder under `<tree>/packages`. */
function packageDirs(tree) {
  const out = new Map();
  for (const e of readdirSync(join(tree, "packages"), { withFileTypes: true })) {
    const manifest = join(tree, "packages", e.name, "package.json");
    if (e.isDirectory() && existsSync(manifest)) out.set(JSON.parse(readFileSync(manifest, "utf8")).name, e.name);
  }
  return out;
}

/**
 * Run a fact-gathering fixture: its `<stem>: data <json>` line is the
 * result. Its `<stem>: FAIL …` line (with the indented lines after it) or no
 * verdict at all throws, which `runChecks` reports as `error`: a journey whose
 * own app is broken has graded nothing.
 */
function goalFixtureData(project, file, stem, env = {}) {
  copyFileSync(join(FIXTURES, file), join(project.dir, file));
  const res = spawnSync(process.execPath, [file], {
    cwd: project.dir,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  const lines = (res.stdout ?? "").split("\n");
  const data = lines.find((l) => l.startsWith(`${stem}: data `));
  if (data) return JSON.parse(data.slice(`${stem}: data `.length));
  const at = lines.findIndex((l) => l.startsWith(`${stem}: FAIL`));
  const detail = at >= 0 ? lines.slice(at, at + 41).join("\n") : `${res.stderr ?? ""}\n${res.stdout ?? ""}`.trim().slice(-800);
  throw new Error(`${file} gave no data (exit ${res.status ?? res.signal}): ${detail}`);
}

/**
 * Import again, with their optional peers now installed, the subpaths the first
 * pass excused. Every one must now import cleanly: an evaluation error, a crash
 * or a hang (a spec the probe never reported) is a failure.
 *
 * A subpath whose peer is `vitest` is imported inside a real vitest run, because
 * that is the only place it can load: vitest throws while evaluating itself
 * outside its runner, before the subpath's own code ever runs, so a plain Node
 * import would prove nothing about that code. Any other peer is imported in
 * plain Node.
 *
 * Exported so a test can run it against throwaway modules.
 *
 * @param {string} dir — the consumer project, with the peers installed.
 * @param {Map<string, string>} needPeer — spec → `peer@range` it waited on.
 * @returns {string[]} failures
 */
export function retryWithPeers(dir, needPeer) {
  const peerOf = (spec) => {
    const s = needPeer.get(spec);
    return s.slice(0, s.lastIndexOf("@"));
  };
  const specs = [...needPeer.keys()];
  const inVitest = specs.filter((s) => peerOf(s) === "vitest");
  const inNode = specs.filter((s) => peerOf(s) !== "vitest");
  const results = [...importEach(dir, inNode), ...vitestProbe(dir, inVitest)];
  return results
    .filter((r) => !r.ok)
    .map((r) => `${r.spec} (with ${needPeer.get(r.spec)}): ${r.code ?? "error"} ${r.message}`);
}

/**
 * Import each spec inside a vitest run in the consumer project, one test per
 * spec, using the vitest the project installed. One result per spec; a spec
 * with no test result (the run crashed or timed out) is `NOT_REACHED`.
 */
function vitestProbe(dir, specs) {
  if (specs.length === 0) return [];
  const probe = "fsd-import-probe.test.mjs";
  copyFileSync(join(FIXTURES, probe), join(dir, probe));
  const { testResults, output } = runVitestJson(dir, [probe], {
    env: { ...process.env, FSD_PROBE_SPECS: JSON.stringify(specs) },
  });
  // No report means the run itself failed: every spec falls through to NOT_REACHED.
  const tests = testResults.flatMap((f) => f.assertionResults);
  const detail = output.slice(-300);
  return specs.map((spec) => {
    const t = tests.find((a) => a.title === spec);
    if (!t) return { spec, ok: false, code: "NOT_REACHED", message: detail };
    if (t.status === "passed") return { spec, ok: true };
    return { spec, ok: false, code: null, message: String(t.failureMessages?.[0] ?? t.status).split("\n")[0] };
  });
}

/**
 * One import pass over every entry point of every installed package. Returns
 * the failures, the subpaths excused for a missing optional peer (for the
 * retry), every spec imported, and the raw results. Shared by the check and
 * the control, so both judge an import by the same rules.
 */
function importPass(project) {
  const failures = [];
  const needPeer = new Map(); // spec → "peer@range"
  const byName = new Map(project.packages.map((p) => [p.name, p]));
  const specs = [];
  for (const pkg of project.packages) {
    const files = packageFiles(join(project.dir, "node_modules", pkg.name));
    const { specs: s, skipped } = importSpecifiers(pkg.manifest, files);
    specs.push(...s);
    for (const { spec, reason } of skipped) log(`    not imported: ${spec} (${reason})`);
  }
  const results = importEach(project.dir, specs);
  for (const result of results) {
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
  return { failures, needPeer, specs, results };
}

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
 * Pack every publishable workspace package into `dest`. Exported for the
 * tarball scan (`scan-tracker-ids-in-tarballs.mjs --all`).
 * @returns {{ name: string, dir: string, tarball: string, manifest: object }[]}
 */
export function packAll(dest) {
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

/**
 * Run each check against the project and log it. Returns how many did not
 * pass; `outcomes`, when given, receives each check's outcome by its `id` (or
 * its name), for the goal judge. A check that throws reports `error`.
 */
function runChecks(project, checks, outcomes = new Map()) {
  let failed = 0;
  for (const check of checks) {
    log(`\n• ${check.id ? `${check.id} · ` : ""}${check.name}`);
    let result;
    try {
      result = check.run(project);
    } catch (err) {
      result = { error: err?.stack ?? String(err) };
    }
    const { outcome, detail } = outcomeOf(result);
    outcomes.set(check.id ?? check.name, { outcome, detail });
    if (outcome === "pass") {
      log("  ✓ pass");
      continue;
    }
    failed += 1;
    if (outcome === "fail") log(`  ✗ ${detail.length} failure(s):`);
    else log(`  ${outcome === "pending" ? "…" : "!"} ${outcome}:`);
    for (const f of detail) log(`    ${f}`);
  }
  return failed;
}

function main() {
  const control = process.argv.includes("--control");
  const linkControl = process.argv.includes("--control=workspace-link");
  const goal = process.argv.includes("--goal");
  const goalControl = process.argv.includes("--control=adopter-goal");
  const movedNameControl = process.argv.includes("--control=moved-name");
  const keep = process.argv.includes("--keep");
  const work = mkdtempSync(join(tmpdir(), "fsd-packed-tarballs-"));
  const dir = emptyProject();
  try {
    if (control) return runControl(work, dir);
    if (linkControl) return runLinkControl(work, dir);
    if (goal) return runGoal(work, dir);
    if (goalControl) return runGoalControl(work, dir);
    if (movedNameControl) return runMovedNameControl(work, dir);

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
  // One pass, judged by the same rules as the real check.
  const project = { dir, packages: [{ name: CONTROL.name, manifest }] };
  log("\n• every package imports (control)");
  const { failures, specs, results } = importPass(project);
  log(`    ${specs.length} entry point(s); ${failures.length} failure(s)`);
  for (const f of failures) log(`    ${f}`);
  const expected = results.filter(isExtensionlessDistImport);
  const failed = failures.length;
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

/**
 * The suite's resolution guard must fail when an installed package is really
 * the repository. Pack and install as the check does, replace
 * {@link LINK_CONTROL} with a symlink to its workspace directory, and run the
 * suite. Returns 0 only when the guard names that package.
 */
function runLinkControl(work, dir) {
  log("packing publishable packages…");
  const packed = packAll(work);
  log("installing into an empty ESM project…");
  npmInstall(dir, packed.map((p) => p.tarball));
  const pkg = packed.find((p) => p.name === LINK_CONTROL);
  if (!pkg) {
    log(`✗ control: ${LINK_CONTROL} was not packed`);
    return 1;
  }
  log(`\n• the suite, with ${LINK_CONTROL} linked to packages/${pkg.dir} (control)`);
  // Linked after the suite's own install, which would otherwise put the tarball back.
  const link = (consumer) => {
    const installed = join(consumer, "node_modules", LINK_CONTROL);
    rmSync(installed, { recursive: true, force: true });
    symlinkSync(join(PACKAGES, pkg.dir), installed, "dir");
  };
  const { failures, violations } = runSuite({ dir, packages: packed }, { beforeRun: link });
  const named = violations.filter((v) => v.id === LINK_CONTROL || v.id.startsWith(`${LINK_CONTROL}/`));
  if (named.length > 0) {
    log(`\n✓ control failed as it must: the resolution guard named ${LINK_CONTROL} ${named.length} time(s)`);
    log(`    e.g. ${named[0].importer}: ${named[0].id} → ${named[0].real}`);
    return 0;
  }
  log(`\n✗ control: the resolution guard did not name ${LINK_CONTROL}; it cannot tell the repository from the install`);
  for (const f of failures.slice(0, 20)) log(`    ${f}`);
  return 1;
}

/**
 * A goal run's project: the consumer install plus what goal checks read. The
 * tree under test, the manifest, a cache of ratchet runs and example copies,
 * and each tarball with its version by package name, for legs that install
 * into a folder of their own.
 *
 * @param {{ tarballs: { name: string, tarball: string, version: string }[] }} opts
 */
function goalProject({ dir, packages, tree, manifest, tarballs }) {
  return {
    dir,
    packages,
    tree,
    manifest,
    ratchetRuns: new Map(),
    exampleRuns: new Map(),
    cleanup: [],
    tarballs: new Map(tarballs.map(({ name, tarball, version }) => [name, { tarball, version }])),
  };
}

/** Write lines to the log and, under GitHub Actions, to the job summary. */
function report(lines) {
  for (const l of lines) log(l);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
}

/**
 * The adopter goal on this checkout's tarballs. Returns 0 when every outcome
 * matches the manifest and none is an error, whatever the row count.
 */
function runGoal(work, dir) {
  const manifest = readManifest();
  log("packing publishable packages…");
  const packed = packAll(work);
  log(`  ${packed.length} tarball(s)`);
  log("installing into an empty ESM project…");
  npmInstall(dir, packed.map((p) => p.tarball));
  const outcomes = new Map();
  const tarballs = packed.map((p) => ({ name: p.name, tarball: p.tarball, version: p.manifest.version }));
  const project = goalProject({ dir, packages: packed, tree: ROOT, manifest, tarballs });
  try {
    runChecks(project, GOAL_CHECKS, outcomes);
  } finally {
    for (const done of project.cleanup) done();
  }
  const verdict = judge(manifest, outcomes);
  log("");
  report([`adopter goal: ${verdict.ok ? "outcomes match the manifest" : "OUTCOMES DO NOT MATCH THE MANIFEST"}`, ...formatVerdict(verdict)]);
  return verdict.ok ? 0 : 1;
}

/**
 * Fetch each pinned published tarball into `work` and check its bytes against
 * the pinned integrity. Throws naming the first tarball that differs.
 *
 * @param {{ name: string, version: string, integrity: string }[]} pins
 * @returns {string[]} tarball paths, in pin order
 */
function fetchPinned(work, pins) {
  return pins.map((pin) => {
    const file = sh("npm", ["pack", `${pin.name}@${pin.version}`, "--pack-destination", work, "--silent"], work)
      .trim()
      .split("\n")
      .pop();
    const tarball = join(work, file);
    const integrity = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
    if (integrity !== pin.integrity)
      throw new Error(`control tarball ${pin.name}@${pin.version} is not the pinned bytes (got ${integrity})`);
    return tarball;
  });
}

/**
 * The goal's control: every published package at its pinned version, checked
 * by integrity, and ratchets reading a checkout of the pinned commit. Returns
 * 0 only when every admitted assertion reports `fail`.
 */
function runGoalControl(work, dir) {
  const manifest = readManifest();
  const pins = manifest.control.packages;
  log(`control: fetching ${pins.length} pinned tarball(s)…`);
  let tarballs;
  try {
    tarballs = fetchPinned(work, pins);
  } catch (err) {
    log(`✗ ${err.message}`);
    return 1;
  }
  log("installing into an empty ESM project…");
  npmInstall(dir, tarballs);
  const packages = pins.map((pin) => ({
    name: pin.name,
    manifest: JSON.parse(readFileSync(join(dir, "node_modules", pin.name, "package.json"), "utf8")),
  }));
  // Ratchets and the First hour leg read the tree as it was at the pinned
  // commit: its ratchet scripts' input, its quick start page, its examples.
  const tree = join(work, "control-tree");
  const archive = join(work, "control-tree.tar");
  sh("git", ["archive", "--format=tar", "-o", archive, manifest.control.commit], ROOT);
  mkdirSync(tree);
  sh("tar", ["xf", archive, "-C", tree], ROOT);
  log(`the tree under test is a checkout of ${manifest.control.commit.slice(0, 8)}`);
  const outcomes = new Map();
  const pinned = pins.map((pin, i) => ({ name: pin.name, tarball: tarballs[i], version: pin.version }));
  const project = goalProject({ dir, packages, tree, manifest, tarballs: pinned });
  try {
    runChecks(project, GOAL_CHECKS, outcomes);
  } finally {
    for (const done of project.cleanup) done();
  }
  const v = judgeControl(manifest, outcomes);
  const lines = [
    v.ok
      ? `✓ control failed as it must: ${v.failedAsTheyMust.length} admitted assertion(s) report fail on the pinned tarballs`
      : "✗ control: an admitted assertion did not fail on the pinned tarballs",
  ];
  for (const id of v.failedAsTheyMust) lines.push(`  fail (as it must): ${id}`);
  for (const id of v.pending) lines.push(`  pending, not yet seen to fail: ${id}`);
  for (const id of v.passed) lines.push(`  PASSED under the control: ${id}; it cannot show progress and is not admitted`);
  for (const e of v.errors) lines.push(`  error: ${e.id}: ${e.detail.join(" | ")}`);
  for (const id of v.missing) lines.push(`  error: ${id} is in the manifest and reported no outcome`);
  for (const id of v.unlisted) lines.push(`  error: ${id} reported an outcome the manifest does not list`);
  log("");
  report(lines);
  return v.ok ? 0 : 1;
}

/**
 * The upgrade journey's planted control. The pinned published tarballs have
 * dropped no root name against themselves, so the goal control cannot show
 * this journey failing on a missing line; this does. Pack and install this
 * checkout as `--goal` does, gather the journey's input, check it passes, and
 * remove every changelog line that counts the removed exports. Returns 0 only
 * when the journey then fails for every package that lost a name, for its
 * missing line.
 */
function runMovedNameControl(work, dir) {
  const manifest = readManifest();
  log("packing publishable packages…");
  const packed = packAll(work);
  log("installing into an empty ESM project…");
  npmInstall(dir, packed.map((p) => p.tarball));
  const tarballs = packed.map((p) => ({ name: p.name, tarball: p.tarball, version: p.manifest.version }));
  const project = goalProject({ dir, packages: packed, tree: ROOT, manifest, tarballs });
  try {
    const { names, lines } = movedNameJourney(project);
    const before = gradeMovedNames(names, lines, { release: isReleaseGrade() });
    if (before.length > 0) {
      report(["✗ control: the journey does not pass on this checkout, so removing its line shows nothing", ...before.slice(0, 20)]);
      return 1;
    }
    const failures = gradeMovedNames(names, plantSummaryRemoval(lines), { release: isReleaseGrade() });
    const unflagged = [...new Set(names.map((n) => n.pkg))].filter(
      (pkg) => !failures.includes(`${pkg}: no changelog line says the ${names.length} exports removed from the package roots`),
    );
    log("");
    report(
      unflagged.length === 0
        ? [`✓ control failed as it must: with the summary line removed, the journey reports ${failures.length} package(s) without it`, ...failures.slice(0, 3)]
        : [`✗ control: with the summary line removed, the journey did not flag ${unflagged.join(", ")}`, ...failures.slice(0, 20)],
    );
    return unflagged.length === 0 ? 0 : 1;
  } finally {
    for (const done of project.cleanup) done();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main());
}
