/**
 * Goal check: an app installs several kits in one list, in any order. Each kit
 * gets what the kits that require it put in its slots, a kit's contribution
 * carries what its own dependents gave it, and every file in a kit's folder
 * is used, or the app refuses to start and names it.
 *
 * Model-free: every leg runs the real path, `fsdev run` against the fixture
 * app's config, and reads what the running app serves or refuses.
 *
 * Run: pnpm tsx goals/kits/install-in-any-order/run.mts
 * Controls: GOAL_CONTROL=list-order | requires-first | skip-unknown (see goal.md)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPatched, describePatches, goalTmpDir, modulePatchEnv, readCapture, REPO_ROOT, runGoal, type ModulePatch } from "../../lib/index.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE = join(HERE, "fixture");
const CONFIG = join(FIXTURE, "fsdev.config.mts");
const TSX = join(REPO_ROOT, "packages/fsdev/node_modules/.bin/tsx");
const FSDEV = join(REPO_ROOT, "packages/fsdev/bin/fsdev.ts");
const TMP = goalTmpDir("kits-install-in-any-order");
const KITS = "packages/engine/src/flowstate/kits.ts";

/** Each control degrades the one behaviour it names, in the engine the app runs. */
const CONTROLS: Record<string, ModulePatch[]> = {
  // Install in the order the app listed, not by `requires`.
  "list-order": [{ module: KITS, from: "const next = pending\\.findIndex\\(", to: "const next = 0 * pending.findIndex(" }],
  // Contribute owners first, so a kit contributes before its dependents and the app fill its slots.
  "requires-first": [{ module: KITS, from: "let rank = order\\.length - 1; rank >= 0; rank--", to: "let rank = 0; rank < order.length; rank++" }],
  // Pass every entry a reader did not claim, as today's loader passes over a stray file.
  "skip-unknown": [{ module: KITS, from: "await opened\\.unclaimed\\(\\)", to: "await opened.unclaimed().then(() => [])" }],
};

const control = process.env.GOAL_CONTROL;
if (control !== undefined && CONTROLS[control] === undefined) {
  throw new Error(`setup: unknown GOAL_CONTROL "${control}"; known: ${Object.keys(CONTROLS).join(", ")}`);
}
const mark = join(TMP, "patched.txt");
const patchEnv = control === undefined ? {} : modulePatchEnv(CONTROLS[control]!, REPO_ROOT, mark);
if (control !== undefined) console.error(`control ${control}:\n${describePatches(CONTROLS[control]!, REPO_ROOT)}`);

/** The environment, without this machine's model overrides (the fixture declares no model). */
function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("FSDEV_") && key !== "GOAL_CASE" && key !== "B_FOLDER") env[key] = value;
  }
  return env;
}

interface Run {
  status: number;
  output: unknown;
  stderr: string;
}

/** `fsdev run <flow> <action>` against the fixture config, from `cwd`. */
function fsdevRun(name: string, flow: string, action: string, options: { cwd?: string; env?: Record<string, string> } = {}): Run {
  const capture = join(TMP, `${name}.json`);
  const ran = spawnSync(TSX, [FSDEV, "run", flow, action, "--input", "{}", "--config", CONFIG, "--capture", capture], {
    cwd: options.cwd ?? FIXTURE,
    env: { ...baseEnv(), ...patchEnv, ...options.env },
    encoding: "utf8",
  });
  let output: unknown;
  if (ran.status === 0) output = readCapture(capture).result.output;
  return { status: ran.status ?? 1, output, stderr: `${ran.stderr ?? ""}${ran.stdout ?? ""}` };
}

/** A folder holding `files`, for a leg that needs one the fixture can't commit. */
function folderWith(name: string, files: Record<string, string>): string {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), body);
  return dir;
}

await runGoal((failures, tell) => {
  const evidence: string[] = [];

  // a · listed [d, b, c]: every kit's flows are served, and b's slots were filled in requires order.
  const read = fsdevRun("a-read", "b-flow", "read");
  const served = ["c-flow", "d-flow"].map((flow) => [flow, fsdevRun(`a-${flow}`, flow, "ping")] as const);
  if (read.status !== 0) failures.push(`a:served · b-flow did not run (exit ${read.status}): ${read.stderr.slice(-400)}`);
  for (const [flow, ran] of served) {
    if (ran.status !== 0) failures.push(`a:served · ${flow} did not run (exit ${ran.status}): ${ran.stderr.slice(-300)}`);
  }
  const answer = (read.output ?? {}) as { greeting?: string; entries?: Record<string, string>; order?: string[] };
  const entries = tell.over("a:entries · b's keyed slot", Object.entries(answer.entries ?? {}));
  const order = tell.over("a:order · b's list slot", answer.order ?? []);
  if (answer.entries?.d !== "from d" || answer.entries?.c === undefined) {
    failures.push(`a:entries · b's keyed slot should hold c's and d's entries, got ${JSON.stringify(answer.entries)}`);
  }
  if (JSON.stringify(order) !== JSON.stringify(["c", "d"])) failures.push(`a:order · b's list should be [c, d], got ${JSON.stringify(order)}`);
  // The chain: c's entry in b is built from c's own slot, which d filled.
  if (answer.entries?.c !== "c carries [from d]") {
    failures.push(`a:chain · c's contribution to b should carry d's fill into c, got ${JSON.stringify(answer.entries?.c)}`);
  }
  if (answer.greeting !== "hello from the fixture app") {
    failures.push(`a:folder · b's default folder should read beside the config, got ${JSON.stringify(answer.greeting)}`);
  }
  evidence.push(`a: entries ${JSON.stringify(Object.fromEntries(entries))}, order ${JSON.stringify(order)}, greeting ${JSON.stringify(answer.greeting)}`);

  // b · three refusals, each named; the app does not start.
  const refusals: Array<[string, Run, RegExp]> = [
    ["b:duplicate", fsdevRun("b-duplicate", "b-flow", "read", { env: { GOAL_CASE: "duplicate" } }), /slot "b\.entries": the key "c" is filled by kit "c" and by kit "d"/],
    [
      "b:stray",
      fsdevRun("b-stray", "b-flow", "read", {
        env: { B_FOLDER: folderWith("stray", { "greeting.txt": "hi\n", "notes.txt": "an author's note\n" }) },
      }),
      /kit "b": "notes\.txt" is not used/,
    ],
    ["b:unrequired", fsdevRun("b-unrequired", "b-flow", "read", { env: { GOAL_CASE: "unrequired" } }), /kit "e" fills slot "b\.order", but does not require kit "b"/],
  ];
  tell.over("b:refusals", refusals);
  for (const [name, ran, named] of refusals) {
    if (ran.status === 0) failures.push(`${name} · the app started and answered ${JSON.stringify(ran.output)}`);
    else if (!named.test(ran.stderr)) failures.push(`${name} · refused, but without naming it (${named}): ${ran.stderr.slice(-400)}`);
    else evidence.push(`${name}: refused, "${ran.stderr.match(named)![0]}"`);
  }

  // c · a relative folder path in config, run from another directory, reads that directory's folder.
  const elsewhere = folderWith("elsewhere/mine", { "greeting.txt": "hello from elsewhere\n" });
  const relative = fsdevRun("c-relative", "b-flow", "read", { cwd: join(elsewhere, ".."), env: { B_FOLDER: "mine" } });
  const greeting = (relative.output as { greeting?: string } | undefined)?.greeting;
  if (greeting !== "hello from elsewhere") {
    failures.push(`c:relative · expected the working directory's folder, got ${JSON.stringify(greeting)} (exit ${relative.status}) ${relative.stderr.slice(-300)}`);
  }
  evidence.push(`c: relative path from ${join(elsewhere, "..")} read ${JSON.stringify(greeting)}`);

  if (control !== undefined) assertPatched(CONTROLS[control]!, REPO_ROOT, mark);
  return { failures, evidence: evidence.join("\n") };
});
