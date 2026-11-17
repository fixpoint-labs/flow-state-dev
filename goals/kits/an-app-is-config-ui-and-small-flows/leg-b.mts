/**
 * Leg b: the teammates host installs the same kits. No browser: the leg is
 * about the host, its kits, its coding flow and its folder (teammates' own
 * browser goals run in the plan's row 3).
 *
 * - `b:installs`: the host lists the workforce and harnesses kits, keeps no
 *   wiring a kit replaces (the lab inventory's host rule), serves the
 *   harness kit's `coder` flow and no coding flow of its own, and
 *   `goals/teammates-lab/a-coding-task-waits-for-your-review/` passes on it.
 * - `b:folder`: a file no reader claims, planted in its `workforce/` tree,
 *   stops the host starting, and the refusal names it.
 * - `w:recorded` (teammates): on that host, the writes teammates' screen makes to the user's own
 *   workers (hire, edit, reset, fire) each match a request that touched the resource.
 * - `b:one-home`: no flow file sits in a kit's folder, and no flow an app
 *   keeps in its own folder is also defined by a package.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { join } from "node:path";
import { goalTmpDir, intentFreeEnv, REPO_ROOT, sleep, stopProcessGroup, type Tell } from "../../lib/index.mts";
import { hostWiring } from "../../../labs/test-support/inventory.mts";
import { grepRepo } from "./inventory.mts";
import { recordedWrites } from "./leg-w.mts";
import { storeAt, watchVersions } from "./store.mts";
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "../../../packages/workforce/src/workers/client.ts";

/** Who teammates serves: it answers every request as its own user (FIX-2539). */
const TEAMMATES_USER = "u_closure";

const TEAMMATES = join(REPO_ROOT, "labs/teammates");
const FSDEV = join(REPO_ROOT, "packages/fsdev/bin/fsdev.ts");
const TSX = join(REPO_ROOT, "packages/fsdev/node_modules/.bin/tsx");
/** What a person might leave in the tree: a file no reader of workforce's folder claims. */
const STRAY = join(TEAMMATES, "workforce/teams/teammates/notes.json");
/** The apps whose kit folders are graded, and the folder of their own flows. */
const APPS = ["labs/teammates", "labs/claude-code-style"];

type Served = { child: ChildProcess; origin: string; log: () => string; exited?: number };

/** `fsdev serve` over teammates' config; resolves once it answers, or once it has exited. */
async function serveTeammates(dir: string, env: Record<string, string>): Promise<Served> {
  const port = 47_000 + randomInt(0, 9_000);
  const origin = `http://127.0.0.1:${port}`;
  let log = "";
  mkdirSync(dir, { recursive: true });
  const workdir = join(dir, "workdir");
  if (!existsSync(workdir)) {
    mkdirSync(workdir, { recursive: true });
    spawnSync("git", ["init", "-q", workdir]);
  }
  const child = spawn(TSX, [FSDEV, "serve", "--port", String(port), "--host", "127.0.0.1"], {
    cwd: TEAMMATES,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: intentFreeEnv(process.env, { GOAL_CONTROL: "", TEAMMATES_STORE: join(dir, "teammates.sqlite"), TEAMMATES_USER, TEAMMATES_WORKDIR: workdir, TEAMMATES_RUNS: join(dir, "runs"), GOAL_HARNESS: "stub", ...env }),
  });
  const keep = (chunk: Buffer) => {
    log += chunk.toString();
    writeFileSync(join(dir, "server.log"), log);
  };
  child.stdout!.on("data", keep);
  child.stderr!.on("data", keep);
  const served: Served = { child, origin, log: () => log };
  for (const end = Date.now() + 180_000; Date.now() < end; await sleep(1_000)) {
    if (child.exitCode !== null) return { ...served, exited: child.exitCode };
    if (await fetch(`${origin}/api/flows`, { signal: AbortSignal.timeout(2_000) }).then((r) => r.ok, () => false)) return served;
  }
  stopProcessGroup(child);
  throw new Error(`setup: teammates neither answered nor exited within 180s; log tail:\n${log.slice(-2000)}`);
}

/** Leg b. `env` carries the control's patches to the hosts it starts. */
export async function legB(failures: string[], notes: string[], tell: Tell, env: Record<string, string>, only: Set<string>): Promise<void> {
  const tmp = goalTmpDir("closure-leg-b");
  if (only.has("b:installs")) {
    const host = readFileSync(join(TEAMMATES, "host.mts"), "utf8");
    const kits = tell.over("b:installs · kits the host lists", ["workforce", "harnesses"].filter((kit) => new RegExp(`\\b${kit}\\(\\{`).test(host)));
    if (kits.length !== 2) failures.push(`b:installs: the host lists ${kits.join(", ") || "neither kit"}, not workforce and harnesses`);
    const wiring = hostWiring(join(TEAMMATES, "host.mts"));
    if (wiring.length > 0) failures.push(`b:installs: the host keeps wiring a kit replaces (${wiring.length}): ${wiring.join(" | ")}`);
    const served = await serveTeammates(join(tmp, "installs"), env);
    try {
      if (served.exited !== undefined) failures.push(`b:installs: teammates didn't start (exit ${served.exited}): ${served.log().slice(-400)}`);
      else {
        const flows = tell.over("b:installs · flows served", ((await (await fetch(`${served.origin}/api/flows`)).json()) as { flows: { id: string }[] }).flows.map((f) => f.id));
        if (!flows.includes("coder")) failures.push(`b:installs: teammates doesn't serve the harness kit's coder flow (${flows.join(", ")})`);
        const own = flows.filter((f) => /coder|harness-readiness/.test(f) && f !== "coder");
        if (own.length > 0) failures.push(`b:installs: teammates serves a coding or readiness flow of its own: ${own.join(", ")}`);
        notes.push(`b:installs: flows ${flows.join(", ")}`);
        // w:recorded on teammates: the writes its screen makes to the user's own workers, each graded as leg a's are.
        const store = storeAt(join(tmp, "installs", "teammates.sqlite"));
        const watch = watchVersions(store);
        const from = Date.now();
        try {
          const workforce = createWorkforceClient(createClient({ userId: TEAMMATES_USER, baseUrl: served.origin }) as never);
          const hired = await workforce.hire({ id: "closure-helper", description: "Helps with the closure's check.", instructions: "Answer in one line." });
          await workforce.edit({ id: "teammates.chief-of-staff", name: "Closure Chief", instructions: "Answer in one line." });
          await workforce.reset("teammates.chief-of-staff");
          await workforce.fire(hired.id);
          await sleep(1_000);
        } finally {
          watch.stop();
        }
        notes.push(`w:recorded (teammates): ${recordedWrites(watch.versions, watch.gaps, store, TEAMMATES_USER, from, failures, tell)}`);
      }
    } finally {
      stopProcessGroup(served.child);
    }
    // Its coding task on the shared flow, as the teammates lab's own goal grades it.
    const goal = spawnSync(TSX, [join(REPO_ROOT, "goals/teammates-lab/a-coding-task-waits-for-your-review/run.mts")], { cwd: join(REPO_ROOT, "goals"), encoding: "utf8", env: intentFreeEnv(process.env, { GOAL_CONTROL: "" }), timeout: 30 * 60_000 });
    const verdict = `${goal.stdout}\n${goal.stderr}`.split("\n").find((line) => /^(PASS|FAIL|CAN'T TELL) —/.test(line)) ?? `exit ${goal.status}`;
    if (goal.status !== 0) failures.push(`b:installs: teammates-lab/a-coding-task-waits-for-your-review: ${verdict} ${goal.stderr.slice(-600)}`);
    notes.push(`b:installs: a-coding-task-waits-for-your-review ${verdict.slice(0, 200)}`);
  }

  if (only.has("b:folder")) {
    if (existsSync(STRAY)) throw new Error(`setup: ${STRAY} exists before the plant`);
    writeFileSync(STRAY, '{ "note": "left here by hand" }\n');
    let served: Served | undefined;
    try {
      served = await serveTeammates(join(tmp, "folder"), env);
      if (served.exited === undefined) failures.push("b:folder: teammates started beside workforce/teams/teammates/notes.json, a file no reader claims");
      else if (!/notes\.json/.test(served.log())) failures.push(`b:folder: teammates stopped, but its refusal doesn't name notes.json: ${served.log().slice(-400)}`);
      else notes.push(`b:folder: refused: ${served.log().split("\n").find((l) => /notes\.json/.test(l))?.trim().slice(0, 200)}`);
    } finally {
      rmSync(STRAY, { force: true });
      if (served !== undefined) stopProcessGroup(served.child);
    }
  }

  if (only.has("b:one-home")) {
    // A flow file in a kit's folder would be copied in as well as imported: each app's workforce/ holds none.
    for (const app of APPS) {
      const code = walk(join(REPO_ROOT, app, "workforce")).filter((rel) => /\.(m?ts|tsx|js)$/.test(rel));
      if (code.length > 0) failures.push(`b:one-home: ${app}/workforce holds code: ${code.join(", ")}`);
    }
    // The reader finds a definition laid out over several lines, as most are, or it proves nothing.
    const sample = 'export const f = defineFlow(\n  {\n    // the kind\n    kind: "closure-sample",\n    actions: {},\n  },\n);\n/** defineFlow({ kind: "in-a-comment" }) */';
    if (flowKindsOf(sample).join() !== '"closure-sample"') throw new Error(`setup: b:one-home's reader read ${JSON.stringify(flowKindsOf(sample))} from a multiline definition`);
    // A flow an app keeps in its own folder: its kind is defined by no package.
    const own = tell.over("b:one-home · flows the apps keep", APPS.flatMap((app) => walk(join(REPO_ROOT, app, "flows")).filter((rel) => rel.endsWith(".mts")).map((rel) => join(app, "flows", rel))));
    for (const file of own) {
      for (const kind of kindsIn(readFileSync(join(REPO_ROOT, file), "utf8"))) {
        const elsewhere = packageFlowFiles().filter((f) => flowKindsOf(f.text).some((k) => k === kind.name || k === `"${kind.value}"`)).map((f) => f.path);
        if (elsewhere.length > 0) failures.push(`b:one-home: ${file} defines flow ${kind.value}, which a package defines too: ${elsewhere.join(" | ")}`);
      }
    }
  }
}

/** Every non-test source file of a package that calls `defineFlow(`, read whole. */
function packageFlowFiles(): { path: string; text: string }[] {
  return grepRepo("defineFlow\\(", ["packages/*/src/**", ":!**/test/**", ":!**/*.test.*"])
    .map((line) => line.split(":")[0]!)
    .filter((path, i, all) => all.indexOf(path) === i)
    .map((path) => ({ path, text: readFileSync(join(REPO_ROOT, path), "utf8") }));
}

/**
 * The `kind:` each `defineFlow({ … })` call in `text` names, however the call is laid out across
 * lines: a quoted literal (with its quotes) or a constant's name. Comments are left out first, so
 * an example in a doc comment isn't a definition.
 */
export function flowKindsOf(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  return [...code.matchAll(/defineFlow\s*\(\s*\{[\s\S]*?\bkind\s*:\s*("[^"]+"|[A-Za-z_$][\w$]*)/g)].map((m) => m[1]!);
}

/** The flow kinds a flow file defines: a literal, or a constant a package exports. */
function kindsIn(text: string): { name: string; value: string }[] {
  return [...text.matchAll(/\bkind:\s*("([^"]+)"|([A-Z_]+))/g)].map((m) => {
    if (m[2] !== undefined) return { name: m[2], value: m[2] };
    const declared = grepRepo(`export const ${m[3]} = "`, ["packages/*/src/**"])[0];
    return { name: m[3]!, value: declared?.match(/= "([^"]+)"/)?.[1] ?? m[3]! };
  });
}

function walk(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" ? [] : e.isDirectory() ? walk(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));
}
