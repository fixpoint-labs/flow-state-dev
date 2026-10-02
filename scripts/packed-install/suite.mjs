/**
 * The shared two-users-one-tenant HTTP suite, run against the installed
 * release instead of the repository.
 *
 * `packages/integration-tests/src/two-users-one-tenant/` holds one case per
 * hole the epic closed, each asking for it over HTTP as a second user in the
 * same tenant. In the repository those cases resolve every package through
 * `src` over a workspace link, which is how 0.1.1 passed every test and failed
 * on its first import. Here the case files and their harness are copied,
 * unchanged, into the packed-install consumer project and run with that
 * project's own vitest and zod, so every `@flow-state-dev/*` import is the
 * installed tarball.
 *
 * Three guards make a pass mean that:
 *
 *   - **Resolution.** A Vite plugin sees every `@flow-state-dev/*` id the run
 *     resolves, deep subpaths included, and fails the import unless the file it
 *     resolved to has a realpath under the consumer's `node_modules/`. It checks
 *     resolution, not file contents: a symlink into the repository reads like an
 *     install and resolves to `src`. `run.mjs --control=workspace-link` swaps
 *     one installed package for exactly that link and exits 0 only if this
 *     guard names it.
 *   - **Totality.** The expected case files are counted from the suite
 *     directory at runtime. The check fails when fewer ran, or any test in them
 *     was skipped, pending or todo.
 *   - **Redis.** The cases that start a queue deployment (leg c) need a real
 *     Redis. Without `REDIS_URL`, or with one that does not answer `PING`, the
 *     runner refuses to start them and fails, whether or not `CI` is set. They
 *     never skip.
 *
 * vitest and zod are installed at the exact versions the lockfile resolves for
 * `packages/integration-tests`, never resolved from the repository. The run is
 * keyless: every `*_API_KEY` variable is removed from the cases' environment.
 *
 * Called from one `CHECKS` entry in `run.mjs`; the control calls it too.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { runVitestJson } from "./vitest-json.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

/** The suite, in the repository. Read for its files and its count, never imported. */
export const SUITE_DIR = join(ROOT, "packages/integration-tests/src/two-users-one-tenant");
/** Where the suite's pinned test dependencies are declared. */
const PIN_IMPORTER = "packages/integration-tests";
/** The test dependencies the copied suite needs from the consumer project. */
const PINNED = ["vitest", "zod"];
/** Where the suite lands inside the consumer project. */
const COPY_DIR = "two-users-one-tenant";
const CONFIG = "fsd-suite.vitest.config.mjs";
const GUARD_LOG = "fsd-suite-resolutions.jsonl";

const log = (msg) => console.log(msg);

/**
 * The exact versions the lockfile resolved for `names` in one importer.
 * `version: 3.2.4(@types/node@22…)` → `3.2.4`.
 *
 * @param {string} lockfile — pnpm-lock.yaml text
 * @param {string} importer — e.g. `packages/integration-tests`
 * @param {string[]} names
 * @returns {Record<string, string>}
 */
export function pinnedVersions(lockfile, importer, names) {
  const lines = lockfile.split("\n");
  const start = lines.indexOf(`  ${importer}:`);
  if (start < 0) throw new Error(`pnpm-lock.yaml has no importer ${importer}`);
  let end = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
  if (end < 0) end = lines.length;
  const block = lines.slice(start, end);
  const out = {};
  for (const name of names) {
    const at = block.findIndex((l) => l === `      ${name}:`);
    const version = at < 0 ? null : /^ {8}version: ([^(\s]+)/.exec(block[at + 2] ?? "")?.[1];
    if (!version) throw new Error(`pnpm-lock.yaml pins no ${name} for ${importer}`);
    out[name] = version;
  }
  return out;
}

/**
 * The suite's case files, counted from the directory at runtime, split into
 * leg b (a plain server) and leg c (a queue deployment, which needs Redis).
 * A case is leg c when it starts a queue deployment.
 *
 * @param {string} dir — the suite directory
 */
export function suiteCases(dir = SUITE_DIR) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".test.ts"))
    .sort();
  const legC = files.filter((f) => /\bstartQueueDeployment\b/.test(readFileSync(join(dir, f), "utf8")));
  return { files, legB: files.filter((f) => !legC.includes(f)), legC };
}

/**
 * The consumer's vitest config: the source suite's timeouts and ordering, and
 * the resolution guard. Written as text into the consumer project, so it loads
 * against the consumer's own vitest.
 */
function configSource(nodeModules) {
  return `// Written by scripts/packed-install/suite.mjs. The resolution guard: every
// @flow-state-dev/* id must resolve to a realpath under ${nodeModules}
import { appendFileSync, realpathSync } from "node:fs";
import { defineConfig } from "vitest/config";

const NODE_MODULES = ${JSON.stringify(nodeModules)};
const LOG = process.env.FSD_SUITE_GUARD_LOG;

function record(entry) {
  appendFileSync(LOG, JSON.stringify(entry) + "\\n");
}

const guard = {
  name: "fsd-resolution-guard",
  enforce: "pre",
  async resolveId(id, importer, options) {
    if (!id.startsWith("@flow-state-dev/")) return null;
    const resolved = await this.resolve(id, importer, { ...options, skipSelf: true });
    const file = resolved?.id?.split("?")[0] ?? null;
    let real = null;
    try {
      real = file && realpathSync(file);
    } catch {
      real = file;
    }
    const ok = real != null && real.startsWith(NODE_MODULES);
    record({ id, importer: importer ?? null, real, ok });
    if (!ok) {
      throw new Error(
        "resolution guard: " + id + " imported by " + importer + " resolved to " + real +
          ", not under the consumer's node_modules"
      );
    }
    return resolved;
  }
};

export default defineConfig({
  plugins: [guard],
  test: {
    testTimeout: 30_000,
    hookTimeout: 10_000,
    sequence: { concurrent: false },
    include: [${JSON.stringify(`${COPY_DIR}/**/*.test.ts`)}]
  }
});
`;
}

/** The environment the cases run in: keyless, and with or without Redis. */
function caseEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) if (/_API_KEY$/.test(key)) delete env[key];
  return env;
}

/** True when `url` answers a Redis `PING` within a few seconds. */
function redisAnswers(url) {
  const probe = `
    const net = require("node:net");
    const u = new URL(process.argv[1]);
    const s = net.connect(Number(u.port || 6379), u.hostname);
    const t = setTimeout(() => process.exit(2), 3000);
    s.on("connect", () => s.write("PING\\r\\n"));
    s.on("data", (d) => { clearTimeout(t); process.exit(String(d).startsWith("+PONG") ? 0 : 3); });
    s.on("error", () => process.exit(4));
  `;
  return spawnSync(process.execPath, ["-e", probe, url], { timeout: 10_000 }).status === 0;
}

/**
 * Run some case files in the consumer project with its own vitest. One result
 * per file: its tests' statuses, or the reason it never produced any.
 */
function runVitest(dir, files, env) {
  const { testResults: results, output } = runVitestJson(
    dir,
    [...files.map((f) => `${COPY_DIR}/${f}`), "--config", CONFIG],
    { env, timeout: 15 * 60_000 },
  );
  const tail = output.slice(-800);
  return files.map((file) => {
    const r = results.find((t) => t.name.endsWith(`/${COPY_DIR}/${file}`));
    if (!r) return { file, ran: false, tests: [], message: tail };
    return {
      file,
      ran: true,
      tests: r.assertionResults.map((a) => ({ title: a.fullName ?? a.title, status: a.status, failure: a.failureMessages?.[0] })),
      message: r.message ?? "",
    };
  });
}

/**
 * Judge one leg's file results: a file that never ran, ran no test, or has a
 * test that is not `passed` (skipped, pending and todo included) is a failure.
 */
export function judgeFiles(results) {
  const failures = [];
  for (const r of results) {
    const count = (s) => r.tests.filter((t) => t.status === s).length;
    const passed = count("passed");
    const other = r.tests.length - passed;
    log(`    ${r.ran ? (other === 0 && r.tests.length > 0 ? "ok  " : "FAIL") : "FAIL"} ${r.file}: ${passed} passed${other ? `, ${other} not passed` : ""}`);
    if (!r.ran) {
      failures.push(`${r.file}: never ran: ${r.message}`);
      continue;
    }
    if (r.tests.length === 0) {
      failures.push(`${r.file}: ran no test: ${String(r.message).split("\n")[0]}`);
      continue;
    }
    for (const t of r.tests) {
      if (t.status === "passed") continue;
      failures.push(`${r.file} › ${t.title}: ${t.status}${t.failure ? `: ${String(t.failure).split("\n")[0]}` : ""}`);
    }
  }
  return failures;
}

/**
 * Copy the suite into the consumer project and run it there: leg b, then leg c.
 *
 * @param {{ dir: string }} project — the consumer project, with every packed
 *   package installed.
 * @param {{ redisUrl?: string, beforeRun?: (dir: string) => void }} [options]
 *   `beforeRun` runs after the pinned install and before any case, for a
 *   control that alters the installed tree (an `npm install` would undo it).
 * @returns {{ failures: string[], violations: { id: string, importer: string, real: string }[] }}
 */
export function runSuite(project, { redisUrl = process.env.REDIS_URL, beforeRun } = {}) {
  const { dir } = project;
  const failures = [];

  const pins = pinnedVersions(readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8"), PIN_IMPORTER, PINNED);
  const specs = PINNED.map((n) => `${n}@${pins[n]}`);
  log(`    installing ${specs.join(", ")} (pinned by ${PIN_IMPORTER})`);
  spawnOrThrow("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", "--save-exact", ...specs], dir);
  for (const n of PINNED) {
    const got = JSON.parse(readFileSync(join(dir, "node_modules", n, "package.json"), "utf8")).version;
    if (got !== pins[n]) failures.push(`${n}: installed ${got}, pinned ${pins[n]}`);
  }
  beforeRun?.(dir);

  rmSync(join(dir, COPY_DIR), { recursive: true, force: true });
  cpSync(SUITE_DIR, join(dir, COPY_DIR), { recursive: true });
  const nodeModules = `${join(realpathSync(dir), "node_modules")}/`;
  writeFileSync(join(dir, CONFIG), configSource(nodeModules));
  const guardLog = join(dir, GUARD_LOG);
  rmSync(guardLog, { force: true });
  writeFileSync(guardLog, "");

  const { files: expected, legB, legC } = suiteCases(SUITE_DIR);
  log(`    ${expected.length} case file(s) in the suite: leg b ${legB.length}, leg c ${legC.length}`);

  log("    leg b · a plain server");
  const results = runVitest(dir, legB, caseEnv({ FSD_SUITE_GUARD_LOG: guardLog }));
  failures.push(...judgeFiles(results));

  log("    leg c · a queue deployment on Redis");
  if (redisUrl == null || redisUrl === "") {
    failures.push(`leg c refused: REDIS_URL is unset, so ${legC.join(", ")} cannot run, and never skips`);
  } else if (!redisAnswers(redisUrl)) {
    failures.push(`leg c refused: Redis at ${redisUrl} does not answer PING`);
  } else {
    const c = runVitest(dir, legC, caseEnv({ FSD_SUITE_GUARD_LOG: guardLog, REDIS_URL: redisUrl, CI: "true" }));
    results.push(...c);
    failures.push(...judgeFiles(c));
  }

  // Totality: every case file the directory holds ran.
  const ran = new Set(results.filter((r) => r.ran).map((r) => r.file));
  const missing = expected.filter((f) => !ran.has(f));
  if (missing.length > 0) failures.push(`${ran.size} of ${expected.length} case file(s) ran; missing ${missing.join(", ")}`);
  const tests = results.flatMap((r) => r.tests);
  log(`    totals: ${ran.size}/${expected.length} case files, ${tests.filter((t) => t.status === "passed").length}/${tests.length} tests passed`);

  // Resolution: every @flow-state-dev/* id resolved under the consumer's node_modules.
  const entries = readFileSync(guardLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const violations = entries
    .filter((e) => !e.ok)
    .map((e) => ({ id: e.id, importer: e.importer ? relative(dir, e.importer) : "?", real: e.real }));
  const seen = new Set(entries.map((e) => e.id));
  log(`    resolution guard: ${entries.length} resolution(s) of ${seen.size} id(s), ${violations.length} outside node_modules`);
  if (entries.length === 0) failures.push("resolution guard saw no @flow-state-dev/* resolution; it is not wired");
  for (const v of violations) failures.push(`resolution guard: ${v.importer} resolved ${v.id} to ${v.real}`);

  return { failures, violations };
}

function spawnOrThrow(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${res.stderr}`);
}
