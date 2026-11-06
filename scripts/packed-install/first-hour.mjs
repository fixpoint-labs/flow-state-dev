/**
 * The adopter goal's First hour leg: what someone who has never seen FSD gets
 * from the quick start, and from copying an example out of the repository,
 * with every `@flow-state-dev/*` package taken from the tarballs under test.
 *
 * **`first-hour.quickstart`** reads the quick start page as a reader does. In
 * an empty folder, in page order: every titled code block is written as the
 * file its title names; every shell block runs, as one `bash -e` script per
 * block; every install line's `@flow-state-dev/*` names map to their
 * tarballs; `pnpm dev` is skipped, because it serves forever and the page's
 * `fsdev run` is the answer this checks. The selection rule is the leg's,
 * never the page's: no marker in the page steers it. The only thing the leg
 * adds is model access: a placeholder `OPENAI_API_KEY` and `OPENAI_BASE_URL`
 * pointing at a local stub (`fixtures/stub-model.mjs`). The cell passes when
 * every block succeeds and the page's `fsdev run` prints the stub's answer.
 * Each block is its own shell, so an `export` in one does not reach the next;
 * the leg's own placeholder key covers the page's `export … sk-...` lines.
 *
 * **`first-hour.example.<name>.<step>`** copies `examples/<name>` to an empty
 * folder and follows the copy-out recipe: rewrite each `workspace:` range to
 * its tarball, `npm install`, then each step's npm script ({@link
 * EXAMPLE_STEPS}). `examples/README.md` carries no recipe yet; this is the
 * interim one, the shape that README is to describe. Each step is its own
 * cell; a step after a failed install fails as not reached.
 *
 * Both run in a temporary folder outside the repository, whose ancestors hold
 * no `@flow-state-dev` install, with the repository's own `node_modules/.bin`
 * taken off `PATH`. After install, every installed `@flow-state-dev/*` must
 * resolve inside the folder at its tarball's version; otherwise the run
 * throws, which the judge reports as `error`, never as an expected fail.
 * Transitive `@flow-state-dev/*` dependencies map to the tarballs through the
 * package manager's overrides, written into the folder's `package.json`: the
 * leg's stand-in for a registry that serves the versions under test.
 */

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { STUB_ANSWER } from "./fixtures/stub-model.mjs";

const STUB_SCRIPT = fileURLToPath(new URL("./fixtures/stub-model.mjs", import.meta.url));

/** The quick start page, relative to the tree under test. */
export const QUICKSTART_PAGE = "apps/docs/docs/getting-started/quick-start.md";

/** A shell line the leg skips: the dev server, which never exits. */
const DEV_SERVER = /^\s*(pnpm|npm|yarn)\s+(run\s+)?dev\s*$/;

/** An install line, whose `@flow-state-dev/*` names map to tarballs. */
const INSTALL_LINE = /^\s*(pnpm\s+(add|install|i)|npm\s+(install|i|add)|yarn\s+add)\b/;

/** A `@flow-state-dev/*` package name, with an optional version or range. */
const FSD_NAME = /(?<![\w/.-])(@flow-state-dev\/[a-z0-9][a-z0-9-]*)(@[^\s'"]+)?/g;

const SHELL_LANGS = new Set(["bash", "sh", "shell", "zsh"]);

/**
 * The quick start as steps, in page order: `{ kind: "file", path, content }`
 * for a block with `title="…"`, `{ kind: "shell", script }` for a shell block
 * (dev-server lines removed; a block left with nothing to run is dropped).
 * Untitled non-shell blocks are prose, not steps.
 */
export function quickstartPlan(markdown) {
  const steps = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!open) continue;
    const [, indent, fence, info] = open;
    const body = [];
    let j = i + 1;
    for (; j < lines.length && !lines[j].startsWith(`${indent}${fence}`); j += 1) body.push(lines[j].slice(indent.length));
    i = j;
    const lang = info.trim().split(/\s+/)[0] ?? "";
    const title = /\btitle=(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(info);
    if (title) {
      steps.push({ kind: "file", path: title[1] ?? title[2] ?? title[3], content: `${body.join("\n")}\n` });
    } else if (SHELL_LANGS.has(lang)) {
      const kept = body.filter((l) => !DEV_SERVER.test(l));
      if (kept.some((l) => l.trim() !== "" && !l.trim().startsWith("#"))) steps.push({ kind: "shell", script: kept.join("\n") });
    }
  }
  return steps;
}

/**
 * Map every `@flow-state-dev/*` name on an install line to its tarball. Lines
 * that are not install lines come back unchanged.
 *
 * @param {Map<string, string>} tarballs — package name → tarball path
 * @returns {{ script: string, unknown: string[] }} `unknown`: names with no tarball.
 */
export function mapInstallLines(script, tarballs) {
  const unknown = [];
  const mapped = script
    .split("\n")
    .map((line) => {
      if (!INSTALL_LINE.test(line)) return line;
      const code = line.replace(/\s#.*$/, "");
      return code.replace(FSD_NAME, (_m, name) => {
        const tarball = tarballs.get(name);
        if (!tarball) {
          unknown.push(name);
          return name;
        }
        return shellQuote(tarball);
      });
    })
    .join("\n");
  return { script: mapped, unknown };
}

/**
 * Rewrite an example's `package.json` for copy-out: each `workspace:` range
 * becomes its tarball, and every tarball is an npm override, so a transitive
 * `@flow-state-dev/*` dependency gets the version under test too.
 *
 * @returns {{ manifest: object, unknown: string[] }} `unknown`: `workspace:` names with no tarball.
 */
export function rewriteExampleManifest(manifest, tarballs) {
  const out = structuredClone(manifest);
  const unknown = [];
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, range] of Object.entries(out[field] ?? {})) {
      if (typeof range !== "string" || !range.startsWith("workspace:")) continue;
      const tarball = tarballs.get(name);
      if (tarball) out[field][name] = `file:${tarball}`;
      else unknown.push(name);
    }
  }
  out.overrides = { ...(out.overrides ?? {}), ...overrides(tarballs) };
  return { manifest: out, unknown };
}

/** Every tarball as a `file:` override. */
function overrides(tarballs) {
  return Object.fromEntries([...tarballs].map(([name, path]) => [name, `file:${path}`]));
}

/**
 * The copy-out recipe's steps after install, one cell each: the example's own
 * npm script, as its README names it. `fsdev` is `--help`, which needs no
 * model and proves the CLI the example depends on runs from the copy.
 */
export const EXAMPLE_STEPS = {
  install: ["npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"]],
  typecheck: ["npm", ["run", "typecheck"]],
  test: ["npm", ["test"]],
  fsdev: ["npm", ["run", "fsdev", "--", "--help"]],
  build: ["npm", ["run", "build"]],
};

const STEP_TIMEOUT = 600_000;

/**
 * The environment a reader's shell has: the runner's, with every model key,
 * provider endpoint and `FSDEV_*` model override removed, the repository's `node_modules/.bin` off `PATH`, and the leg's
 * placeholder key and stub endpoint when `stub` is given.
 */
export function readerEnv(base, repoRoot, stub) {
  const env = { ...base };
  for (const k of Object.keys(env))
    if (/^(OPENAI|ANTHROPIC|GOOGLE_GENERATIVE_AI|AI_GATEWAY|OPENROUTER|FSDEV)_/.test(k)) delete env[k];
  for (const k of ["INIT_CWD", "npm_config_local_prefix", "PNPM_SCRIPT_SRC_DIR"]) delete env[k];
  for (const k of Object.keys(env)) if (k.startsWith("npm_package_") || k.startsWith("npm_lifecycle_")) delete env[k];
  const root = resolve(repoRoot);
  env.PATH = (env.PATH ?? "")
    .split(delimiter)
    .filter((p) => p !== "" && resolve(p) !== root && !resolve(p).startsWith(`${root}${sep}`))
    .join(delimiter);
  if (stub) {
    env.OPENAI_API_KEY = "sk-placeholder-not-a-key";
    env.OPENAI_BASE_URL = stub;
  }
  return env;
}

/**
 * Refuse to run in a folder a `@flow-state-dev` install above it could leak
 * into: Node walks every ancestor's `node_modules`.
 */
export function assertIsolated(dir) {
  for (let d = dirname(resolve(dir)); ; d = dirname(d)) {
    if (existsSync(join(d, "node_modules", "@flow-state-dev")))
      throw new Error(`${d}/node_modules/@flow-state-dev exists above ${dir}; an install there would shadow the tarballs`);
    if (dirname(d) === d) break;
  }
}

/**
 * The resolution guard for a copied-out folder: every installed
 * `@flow-state-dev/*` resolves inside the folder, at its tarball's version.
 *
 * @param {Map<string, { version: string }>} versions — package name → packed version
 * @returns {string[]} violations
 */
export function installedOutsideTarballs(dir, versions) {
  const violations = [];
  const scope = join(dir, "node_modules", "@flow-state-dev");
  if (!existsSync(scope)) return violations;
  const inside = `${realpathSync(dir)}${sep}`;
  for (const entry of readdirSync(scope)) {
    const name = `@flow-state-dev/${entry}`;
    const real = realpathSync(join(scope, entry));
    if (!real.startsWith(inside)) {
      violations.push(`${name} resolves to ${real}, outside the folder`);
      continue;
    }
    const want = versions.get(name)?.version;
    const got = JSON.parse(readFileSync(join(real, "package.json"), "utf8")).version;
    if (want == null) violations.push(`${name}@${got} is installed and is not one of the tarballs`);
    else if (got !== want) violations.push(`${name} installed ${got}, the tarball is ${want}`);
  }
  return violations;
}

/**
 * A bare `fsdev` on the reader's `PATH` must be the folder's own install: a
 * globally linked workspace CLI would run the repository's code and call it
 * the tarball. Not on `PATH` at all is the reader's problem, and the block
 * fails as it would for them.
 */
export function assertFsdevFromFolder(dir, env) {
  const res = spawnSync("bash", ["-c", "command -v fsdev"], { cwd: dir, env, encoding: "utf8" });
  const found = (res.stdout ?? "").trim();
  if (res.status !== 0 || found === "") return;
  const real = realpathSync(found);
  if (!real.startsWith(`${realpathSync(dir)}${sep}`))
    throw new Error(`resolution guard: fsdev on PATH is ${found} (${real}), outside the folder`);
}

function shellQuote(s) {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

function tail(res) {
  return `${res.stderr ?? ""}\n${res.stdout ?? ""}`.trim().slice(-800);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Start the stub model; returns its base URL and a stop function. */
function startStub(work) {
  const portFile = join(work, "stub-model.url");
  rmSync(portFile, { force: true });
  const child = spawn(process.execPath, [STUB_SCRIPT, portFile], { stdio: "ignore" });
  for (let i = 0; i < 100 && !existsSync(portFile); i += 1) sleepSync(50);
  if (!existsSync(portFile)) {
    child.kill();
    throw new Error("the stub model did not start within 5s");
  }
  const url = readFileSync(portFile, "utf8").trim();
  const served = () => (existsSync(`${portFile}.log`) ? readFileSync(`${portFile}.log`, "utf8").trim().split("\n").filter(Boolean) : []);
  return { url, served, stop: () => child.kill() };
}

/**
 * Run the quick start in `dir`, an empty folder. Returns the cell's failures;
 * throws when the run itself is broken (the stub would not start, the folder
 * is not isolated, a package resolved outside the folder).
 *
 * @param {{ markdown: string, dir: string, repoRoot: string, tarballs: Map<string, string>, versions: Map<string, { version: string }>, log?: (s: string) => void }} opts
 */
export function runQuickstart({ markdown, dir, repoRoot, tarballs, versions, log = () => {} }) {
  assertIsolated(dir);
  const steps = quickstartPlan(markdown);
  if (!steps.some((s) => s.kind === "shell" && /\bfsdev\s+run\b/.test(s.script)))
    return ["the quick start has no `fsdev run` block, so it never shows an answer"];
  // pnpm overrides map transitive @flow-state-dev/* dependencies to the tarballs.
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ pnpm: { overrides: overrides(tarballs) } }, null, 2)}\n`);
  const stub = startStub(dirname(dir));
  try {
    const env = readerEnv(process.env, repoRoot, stub.url);
    // The guard runs before any verdict, pass or fail: a run that installed a
    // package from outside the folder is broken, not an expected fail.
    const guard = () => {
      const violations = installedOutsideTarballs(dir, versions);
      if (violations.length > 0) throw new Error(`resolution guard: ${violations.join("; ")}`);
    };
    let answered = null;
    for (const [n, step] of steps.entries()) {
      if (step.kind === "file") {
        mkdirSync(dirname(join(dir, step.path)), { recursive: true });
        writeFileSync(join(dir, step.path), step.content);
        log(`    wrote ${step.path}`);
        continue;
      }
      const { script, unknown } = mapInstallLines(step.script, tarballs);
      const first = step.script.split("\n").find((l) => l.trim() && !l.trim().startsWith("#"))?.trim();
      if (unknown.length > 0) {
        guard();
        return [`quickstart: FAIL at block ${n + 1} (${first}): installs ${unknown.join(", ")}, which has no tarball`];
      }
      if (/^\s*fsdev\b/m.test(step.script)) assertFsdevFromFolder(dir, env);
      const res = spawnSync("bash", ["-e", "-c", script], { cwd: dir, env, encoding: "utf8", timeout: STEP_TIMEOUT, maxBuffer: 64 * 1024 * 1024 });
      log(`    ran ${first} · exit ${res.status ?? res.signal}`);
      if (res.status !== 0) {
        guard();
        return [`quickstart: FAIL at block ${n + 1} (${first}): exit ${res.status ?? res.signal}`, ...tail(res).split("\n").slice(-12)];
      }
      if (/\bfsdev\s+run\b/.test(step.script)) answered = (res.stdout ?? "").includes(STUB_ANSWER);
    }
    guard();
    if (!answered)
      return [`quickstart: FAIL at fsdev run: exited 0 without the stub's answer (${stub.served().length} model request(s) served)`];
    return [];
  } finally {
    stub.stop();
  }
}

/**
 * One example's copy-out run, step by step on demand: `step(name)` runs the
 * recipe up to and including that step once and returns its failures.
 * Install runs first and once; a later step after a failed install fails as
 * not reached.
 *
 * @param {{ src: string, dir: string, repoRoot: string, tarballs: Map<string, string>, versions: Map<string, { version: string }>, log?: (s: string) => void }} opts
 */
export function exampleRun({ src, dir, repoRoot, tarballs, versions, log = () => {} }) {
  const results = new Map();
  const env = readerEnv(process.env, repoRoot, null);
  const run = (step) => {
    const [cmd, args] = EXAMPLE_STEPS[step];
    const res = spawnSync(cmd, args, { cwd: dir, env, encoding: "utf8", timeout: STEP_TIMEOUT, maxBuffer: 64 * 1024 * 1024 });
    log(`    ${step}: ${[cmd, ...args].join(" ")} · exit ${res.status ?? res.signal}`);
    return res.status === 0 ? [] : [`${step}: exit ${res.status ?? res.signal}`, ...tail(res).split("\n").slice(-12)];
  };
  let broken = null;
  const install = () => {
    if (broken) throw broken;
    if (results.has("install")) return results.get("install");
    try {
      results.set("install", copyAndInstall());
    } catch (err) {
      broken = err;
      throw err;
    }
    return results.get("install");
  };
  const copyAndInstall = () => {
    assertIsolated(dir);
    if (!existsSync(join(src, "package.json"))) throw new Error(`${src} has no package.json`);
    cpSync(src, dir, { recursive: true, filter: (p) => !/(^|[\\/])(node_modules|\.next|\.turbo|dist)$/.test(p) });
    const { manifest, unknown } = rewriteExampleManifest(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")), tarballs);
    writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const failures = unknown.length > 0 ? [`install: ${unknown.join(", ")} has no tarball`] : run("install");
    if (failures.length === 0) {
      const violations = installedOutsideTarballs(dir, versions);
      if (violations.length > 0) throw new Error(`resolution guard: ${violations.join("; ")}`);
    }
    return failures;
  };
  return {
    step(name) {
      if (!(name in EXAMPLE_STEPS)) throw new Error(`no copy-out step named ${name}`);
      const installed = install();
      if (name === "install") return installed;
      if (installed.length > 0) return [`${name}: not reached, install failed`];
      if (!results.has(name)) results.set(name, run(name));
      return results.get(name);
    },
  };
}
