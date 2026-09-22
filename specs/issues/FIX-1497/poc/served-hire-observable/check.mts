/**
 * The experiment: can the shipped `fsdev dev` serve a hired Workforce, so the
 * DevTool has a hire to inspect without anything written to make it possible?
 *
 * **Retained evidence, not a goal check and not production code.** FIX-1497's
 * whole acceptance shape rests on one premise that could not be read off
 * source: that seats and a channel minted from a Markdown tree are ordinary
 * registered flow instances the shipped dev server will serve, addressable in
 * the DevTool's navigator like any other copy. This runs the real server and
 * reads the real catalog.
 *
 * **What it deliberately does not establish.** Nothing about the scenario's
 * *run* — that is the goal check's job ([PLAN.md](../../PLAN.md) V1–VG), not a
 * registration probe's. Execution on the served path **does** work; see
 * README.md → "The stall, and what it turned out to be" for the environment
 * variable that hides it and the A/B that settled it.
 *
 * Run:
 *   pnpm tsx specs/issues/FIX-1497/poc/served-hire-observable/check.mts
 * Controls (each must FAIL):
 *   POC_CONTROL=no-tree   — the hire reads a directory that is not there.
 *                           Coarse: the server does not start, so every leg
 *                           goes red at once.
 *   POC_CONTROL=no-answer — the worker kind is built without its answer action.
 *                           The server starts and every seat registers, so only
 *                           the answer assertion moves. This is the isolating
 *                           red state.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The shared helper, not a copy of it. PLAN's guardrail says the graded run
// strips the intent overrides "exactly as every other goal does", and the A/B
// this POC banked is what makes that guardrail load-bearing — a local subset
// could drift away from the verdict it is evidence for.
import { intentFreeEnv } from "../../../../../goals/lib/env.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CONFIG = join(HERE, "fsdev.config.mts");
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..", "..");
/**
 * A port this run is unlikely to share, and **never** a fixed one.
 *
 * A fixed port is a false-PASS waiting to happen: if anything already owns it —
 * including a second copy of this probe — the spawned server dies on
 * `EADDRINUSE` while the readiness poll happily answers from the incumbent, and
 * a catalog that happens to match makes the check report PASS having served
 * nothing. The child-exit guard below closes the same hole from the other side;
 * both are here because either alone leaves a window.
 */
const PORT = 4300 + Math.floor(Math.random() * 400);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const API = `${ORIGIN}/api/flows`;

/**
 * The control, and the whole of it.
 *
 * `no-tree` points the hire at a directory that does not exist. The flow
 * modules throw on import, the server starts with nothing registered, and every
 * assertion below must go red by name. It perturbs the tree and never the
 * check, so a green run cannot be one where the check simply agreed with
 * itself.
 */
const CONTROL = process.env.POC_CONTROL ?? "";

/**
 * Why the server is spawned on a stripped environment at all.
 *
 * `FSDEV_DEFAULT_MODEL` set while no flow declares an intent makes
 * `createModelResolver` throw, and on the served path that throw leaves a
 * request at `in_progress` with no items and nothing on the router's
 * `onError` — for a flow with no generator in it at all. A probe that
 * inherited the overrides would be measuring the environment. The A/B that
 * established this is in README.md; `goals/lib/env` strips the same prefix
 * set before every goal run, for the same reason.
 */

const notes: string[] = [];
const failures: string[] = [];
const check = (ok: boolean, failure: string) => {
  if (!ok) failures.push(failure);
};

/**
 * Wait for **our** server, not for whichever one answers.
 *
 * A healthy `/healthz` proves something is listening, not that it is the child
 * this run spawned. So the child's exit is watched too, and an exit before
 * readiness ends the wait as a failure rather than letting the poll settle on
 * an incumbent process — the false-PASS Codex named (`EADDRINUSE` plus a
 * catalog that happens to match).
 */
async function waitForServer(): Promise<boolean> {
  for (let i = 0; i < 120; i += 1) {
    if (childExit !== undefined) return false;
    try {
      if ((await fetch(`${ORIGIN}/healthz`)).status === 200) {
        // One more look: the child may have died in the same tick the
        // incumbent answered.
        return childExit === undefined;
      }
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let server: ChildProcess | undefined;
let serverLog = "";
/** Set the moment the spawned server exits, whenever that happens. */
let childExit: { code: number | null; signal: string | null } | undefined;
try {
  const workDir = mkdtempSync(join(tmpdir(), "er-collab-poc-"));
  server = spawn(
    join(REPO_ROOT, "node_modules", ".bin", "tsx"),
    [
      join(REPO_ROOT, "packages", "cli", "bin", "fsdev.ts"),
      "dev",
      // The POC's own config, not directory discovery. `--config` is what lets
      // this experiment stay package-free: the hire needs a top-level await to
      // read the tree, and only an ESM module may have one.
      "--config",
      CONFIG,
      "--no-open",
      "--port",
      String(PORT),
    ],
    {
      cwd: workDir,
      env: intentFreeEnv(process.env, {
        FSDEV_DEBUG_ENDPOINTS: "1",
        ...(CONTROL === "no-tree"
          ? { ER_COLLAB_POC_TREE: join(workDir, "no-such-workforce") }
          : {}),
        ...(CONTROL === "" ? {} : { ER_COLLAB_POC_CONTROL: CONTROL }),
      }),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout?.on("data", (c) => (serverLog += String(c)));
  server.stderr?.on("data", (c) => (serverLog += String(c)));
  server.on("exit", (code, signal) => (childExit = { code, signal }));

  if (!(await waitForServer())) {
    // Under `no-tree` the server refuses to start at all, which is a red state
    // for every assertion below rather than a reason to stop reading.
    //
    // A missing DevTool bundle lands here too, and it is the one failure a
    // reader is likely to hit on a clean checkout, so it names its own fix
    // rather than being reported as a generic timeout.
    if (serverLog.includes("DevTool assets not found")) {
      check(
        false,
        "the DevTool bundle is not built, so `fsdev dev` refused to start. Build it once:\n" +
          "      pnpm --filter @flow-state-dev/devtool build\n" +
          "      pnpm --filter @flow-state-dev/devtool build:assets\n" +
          "    (`cd apps/devtool && pnpm build` alone is NOT enough — it needs the\n" +
          "    `packages/devtool` build first, and only `build:assets` populates\n" +
          "    `packages/devtool/dist-client`, which is what resolves from any cwd.)",
      );
    } else if (childExit !== undefined) {
      check(
        false,
        `the dev server exited before it was ready (code ${childExit.code}, signal ${childExit.signal}) — ` +
          `nothing this run spawned ever served ${ORIGIN}`,
      );
    } else {
      check(false, `the dev server never became ready on ${ORIGIN}`);
    }
    for (const want of ["eng.planner", "eng.builder", "eng.reviewer", "channel"]) {
      check(false, `the served catalog is missing "${want}" — the server did not start`);
    }
  } else {
    // ---- (a) the shipped server registers the file-declared hire ------------
    const catalog = (await (await fetch(API)).json()) as {
      flows: Array<{ id: string; kind: string; cardinality: string; actions: string[] }>;
    };
    const ids = catalog.flows.map((f) => f.id).sort();
    notes.push(`catalog: ${ids.join(", ") || "(empty)"}`);
    for (const want of ["eng.planner", "eng.builder", "eng.reviewer", "channel"]) {
      check(ids.includes(want), `the served catalog is missing "${want}" (got: ${ids.join(", ") || "none"})`);
    }

    // ---- (b) two seats on one kind, addressable one at a time ---------------
    const byId = new Map(catalog.flows.map((f) => [f.id, f]));
    const builder = byId.get("eng.builder");
    const reviewer = byId.get("eng.reviewer");
    check(
      builder?.kind === "worker" && reviewer?.kind === "worker",
      `the two worker seats are not one kind (builder: ${builder?.kind}, reviewer: ${reviewer?.kind})`,
    );
    check(
      builder?.cardinality === "collection",
      "a seat is not a collection-cardinality copy, so the navigator cannot open one seat at a time",
    );

    // ---- (c) the doors the scenario drives are the channel's own ------------
    const channelActions = (byId.get("channel")?.actions ?? []).sort();
    notes.push(`channel actions: ${channelActions.join(", ") || "(none)"}`);
    for (const door of ["post", "read", "fileTask", "readBoard"]) {
      check(
        channelActions.includes(door),
        `the served channel does not expose "${door}" — the scenario would need a door of its own`,
      );
    }

    // ---- (d) each seat carries its own drain and its own answer door --------
    for (const seat of ["eng.builder", "eng.reviewer"]) {
      const actions = (byId.get(seat)?.actions ?? []).sort();
      notes.push(`${seat} actions: ${actions.join(", ") || "(none)"}`);
      check(actions.includes("drain"), `${seat} exposes no drain`);
      check(
        actions.includes("answer"),
        `${seat} exposes no answer action — the person would have no flow action to answer through`,
      );
    }
    const plannerActions = (byId.get("eng.planner")?.actions ?? []).sort();
    notes.push(`eng.planner actions: ${plannerActions.join(", ") || "(none)"}`);
    check(
      plannerActions.includes("file") && !plannerActions.includes("drain"),
      `the planner seat should file and never drain (has: ${plannerActions.join(", ")})`,
    );
  }
} catch (error) {
  failures.push(`threw: ${error instanceof Error ? error.message : String(error)}`);
  notes.push(`server log tail:\n${serverLog.slice(-1500)}`);
} finally {
  server?.kill("SIGTERM");
}

for (const note of notes) console.log(`· ${note}`);
if (failures.length === 0) {
  console.log(
    "PASS — the shipped `fsdev dev` registers a file-declared hire: three seats on two kinds, " +
      "the channel singleton with its four doors, and an answer action on each worker seat",
  );
} else {
  console.log(`FAIL${CONTROL === "" ? "" : ` (control: ${CONTROL})`}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
