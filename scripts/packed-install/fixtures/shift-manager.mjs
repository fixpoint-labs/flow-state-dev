/**
 * Runs inside the consumer project the packed-install check builds, and does
 * what someone who installed Shift Manager does: run the installed
 * `shift-manager` command over a Lab of their own, then read the page, one of
 * its assets, and the Lab's API from the one port it prints.
 *
 * Before it runs anything, it reads the installed package: it must hold the
 * built pages, the shift profiles and the command, and none of the checkout's
 * source, team profiles or tests (BR-24). The pages must resolve inside the
 * installed package, so a copy left in the repository cannot stand in for one
 * the tarball did not carry.
 *
 * The Lab is written here, a config importing only installed packages, so
 * nothing from the repository is on its path.
 *
 * Exits 0 and prints `shift-manager: ok` on success; anything else exits 1
 * with the step that failed.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { getAssetPath } from "@flow-state-dev/shift-manager";

/** The running command, stopped before a failure exits. */
let child;
const fail = (step, detail) => {
  child?.kill("SIGTERM");
  console.error(`shift-manager: FAIL at ${step}: ${detail}`);
  process.exit(1);
};

// ---- the installed package ---------------------------------------------------
const installed = realpathSync(join(process.cwd(), "node_modules", "@flow-state-dev", "shift-manager"));
for (const file of ["dist-client/index.html", "dist/bin.js", "dist/index.js", "profiles/day.json", "profiles/night.json"]) {
  if (!existsSync(join(installed, file))) fail("contents", `the installed package has no ${file}`);
}
for (const dir of ["src", "teams", "test", "cli", "scripts"]) {
  if (existsSync(join(installed, dir))) fail("contents", `the installed package ships ${dir}/`);
}
if (readdirSync(join(installed, "dist-client")).includes("build-inputs.json"))
  fail("contents", "the installed package ships the checkout's build-inputs.json");
const pages = realpathSync(getAssetPath());
if (!pages.startsWith(installed + sep)) fail("getAssetPath", `${pages} is not inside the installed package at ${installed}`);

// ---- a Lab of the consumer's own ----------------------------------------------
mkdirSync("sm-lab", { recursive: true });
writeFileSync(
  join("sm-lab", "fsdev.config.mjs"),
  `import { defineFlow } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
const flow = defineFlow({ kind: "packed-install-shift-manager", actions: {} })();
export default createFlowState({
  flows: { "packed-install-shift-manager": flow },
  stores: { default: { primary: inMemoryStores() } },
  devtool: { userId: "u_packed_install" },
});
`,
);

// ---- the installed command ----------------------------------------------------
const bin = join(process.cwd(), "node_modules", ".bin", "shift-manager");
if (!existsSync(bin)) fail("bin", "npm linked no shift-manager command");
child = spawn(bin, ["--config", "./sm-lab/fsdev.config.mjs", "--port", "0", "--no-open"], {
  cwd: process.cwd(),
  env: { ...process.env, INIT_CWD: process.cwd() },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (d) => (log += String(d)));
child.stderr.on("data", (d) => (log += String(d)));
const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));

let origin;
for (let waited = 0; waited < 45_000 && origin === undefined; waited += 250) {
  const app = /App:\s+(http:\/\/\S+)/.exec(log);
  if (app !== null && /Data:/.test(log)) origin = new URL(app[1].replace("//localhost:", "//127.0.0.1:")).origin;
  else if (child.exitCode !== null) fail("start", `exited ${child.exitCode}: ${log.trim().slice(-600)}`);
  else await new Promise((r) => setTimeout(r, 250));
}
if (origin === undefined) {
  child.kill("SIGTERM");
  fail("start", `printed no address: ${log.trim().slice(-600)}`);
}

try {
  if (!log.includes(pages)) fail("start", `served pages from elsewhere than the installed build: ${log.trim().slice(-600)}`);
  const page = await fetch(`${origin}/`);
  const html = await page.text();
  if (!page.ok || !/text\/html/.test(page.headers.get("content-type") ?? "")) fail("index", `status ${page.status}`);
  if (!/<meta name="fsdev-devtool-url" content="http:\/\/127\.0\.0\.1:\d+\/">/.test(html))
    fail("index", "the page carries no DevTool address");
  if (!html.includes('"userId":"u_packed_install"')) fail("index", "the page carries no connection config");
  const script = /<script[^>]*\ssrc="([^"]+\.js)"/.exec(html)?.[1];
  if (script === undefined) fail("index", `no <script src> in the page: ${html.slice(0, 300)}`);
  const asset = await fetch(new URL(script, origin));
  if (!asset.ok || !/javascript/.test(asset.headers.get("content-type") ?? "")) fail("asset", `${script}: ${asset.status} ${asset.headers.get("content-type")}`);
  const api = await fetch(`${origin}/api/flows`);
  if (api.status !== 200) fail("api", `/api/flows: ${api.status}`);
  console.log(`shift-manager: ok (${origin} serves ${script} and /api/flows from ${pages})`);
} catch (error) {
  fail("read", String(error?.message ?? error));
}
child.kill("SIGTERM");
const code = await exited;
if (code !== 0) fail("stop", `exited ${code} on SIGTERM`);
