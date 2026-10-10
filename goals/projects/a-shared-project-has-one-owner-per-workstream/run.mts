/**
 * Goal check: two users of one org each own a workstream in one shared
 * project; each reads both workstreams' status and neither can change the
 * other's; each talks to the project through their own coordinator, which
 * hands work only to their own workstreams; a private project is reachable by
 * nobody else, Alice in her second org included (FIX-1793). See goal.md.
 *
 * Shift Manager's DevTeam install, served by its own command over a fresh
 * SQLite store, with two scratch module patches (`controls/patches.mts`): a
 * bearer for Alice in a second organization, and a registered flow that
 * writes the entries directly. The legs are in `legs.mts`.
 *
 * Run:      pnpm tsx goals/projects/a-shared-project-has-one-owner-per-workstream/run.mts
 * Controls: GOAL_CONTROL=no-owner-rule (legs a, b; must fail b:bobs-write-refused)
 *           GOAL_CONTROL=all-entries-delegate (legs a to c; must fail c:never-to-bobs)
 * Legs:     GOAL_LEGS=a | a,b | a,b,c (default: all; each leg needs the ones before it)
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, RUN_STAMP, assertPatched, goalTmpDir, keysServing, loadFixture, runGoal } from "../../lib/index.mts";
import { buildShiftManagerPages, SHIFT_MANAGER, startShiftManager } from "../../lib/shift-manager.mts";
import { CONTROL_NAMES, CONTROLS, describePatches, patchEnv, patchesFor, SECOND_ORG, type Control } from "./controls/patches.mts";
import { drawInputs, runLegs, type Inputs, type LegResult, type Person } from "./legs.mts";

const SCRATCH = goalTmpDir("projects-one-owner");
const ALL_LEGS = ["a", "b", "c"] as const;
const say = (s: string) => console.error(`[projects ${new Date().toISOString().slice(11, 19)}] ${s}`);

const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && !(CONTROL_NAMES as readonly string[]).includes(controlName)) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${CONTROL_NAMES.join(", ")}`);
  process.exit(2);
}
const control: Control | undefined = controlName === "" ? undefined : CONTROLS[controlName as keyof typeof CONTROLS];
const legs = new Set((process.env.GOAL_LEGS ?? (control === undefined ? ALL_LEGS.join(",") : control.legs.join(","))).split(",").map((s) => s.trim()).filter(Boolean));
for (const l of legs) if (!(ALL_LEGS as readonly string[]).includes(l)) throw new Error(`unknown leg "${l}" in GOAL_LEGS`);
for (const [i, l] of ALL_LEGS.entries()) if (legs.has(l) && ALL_LEGS.slice(0, i).some((x) => !legs.has(x))) throw new Error(`leg ${l} needs the legs before it`);

const PROFILE = join(SHIFT_MANAGER, "teams", "devteam");

/** The model the DevTeam's project coordinator names on its `model:` line. */
function coordinatorModel(): string {
  const file = join(PROFILE, "workforce", "org", "workers", "project-coordinator", "WORKER.md");
  const model = /^model:\s*(\S+)\s*$/m.exec(readFileSync(file, "utf8"))?.[1];
  if (model === undefined) throw new Error(`setup: ${file} names no model`);
  return model;
}

await runGoal(async (failures) => {
  const model = coordinatorModel();
  const keys = keysServing(model);
  if (!keys.some((k) => (process.env[k] ?? "") !== "")) {
    return { failures: [`blocked: no key here serves ${model}; none of ${keys.join(", ")} is set`], evidence: "" };
  }
  const host = (await import(pathToFileURL(join(PROFILE, "host.mts")).href)) as { LAB_USERS?: Record<string, { userId: string; bearer: string }> };
  const users = host.LAB_USERS;
  if (users?.owner === undefined || users.member === undefined) throw new Error("setup: the DevTeam host exports no LAB_USERS owner and member");
  const alice: Person = { label: "Alice", ...users.owner };
  const bob: Person = { label: "Bob", ...users.member };
  const alice2: Person = { label: "Alice (second org)", userId: users.owner.userId, bearer: SECOND_ORG.bearer };

  const drawn = drawInputs(loadFixture<Inputs>(import.meta.url, "inputs.json"));
  say(`inputs: private "${drawn.privateProject.id}", shared "${drawn.sharedProject.id}", Alice's "${drawn.aliceWs.id}", Bob's "${drawn.bobWs.id}", Bob's status "${drawn.statusWord}", work word "${drawn.workWord}"`);

  // The pages are only served, never graded: the shipped build when there is one.
  const built = join(SHIFT_MANAGER, "dist-client");
  const pages = existsSync(join(built, "index.html")) ? built : await buildShiftManagerPages(join(SCRATCH, "pages"));

  const patches = patchesFor(control);
  mkdirSync(SCRATCH, { recursive: true });
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  say(`legs ${[...legs].join(", ")}${control === undefined ? "" : `; control ${control.name}: ${control.does}`}; patches:\n${describePatches(patches, REPO_ROOT)}`);

  const storeDir = join(SCRATCH, "stores", `${RUN_STAMP}-${control?.name ?? "plain"}`);
  mkdirSync(storeDir, { recursive: true });
  const store = join(storeDir, "devteam.sqlite");
  const served = await startShiftManager({
    scratch: SCRATCH,
    label: `devteam-${control?.name ?? "plain"}`,
    config: join(PROFILE, "fsdev.config.mts"),
    pages,
    env: { DEVTEAM_STORE: store, ...patchEnv(patches, REPO_ROOT, mark) },
    timeoutMs: 180_000,
  });
  let results: Record<string, LegResult> = {};
  try {
    say(`DevTeam at ${served.origin}`);
    results = await runLegs({ origin: served.origin, store, alice, bob, alice2, drawn, legs, say });
  } catch (error) {
    say(`server log tail:\n${served.log().slice(-3000)}`);
    throw error;
  } finally {
    await served.stop();
    rmSync(storeDir, { recursive: true, force: true });
  }
  // Every patch reached the code the install ran, or this run shows nothing.
  assertPatched(patches, REPO_ROOT, mark);
  say(`every patch reached its module: ${[...new Set(patches.map((p) => p.module))].join(", ")}`);

  for (const l of ALL_LEGS) {
    const r = results[l];
    if (r === undefined) continue;
    for (const note of r.notes) say(`${l}: ${note}`);
    say(`leg ${l}: ${r.failures.length === 0 ? "PASS" : `FAIL (${[...new Set(r.failures.map((f) => f.split(" — ")[0]))].join(", ")})`}`);
    failures.push(...r.failures);
  }
  if (control !== undefined) {
    const named = failures.some((f) => f.startsWith(`${control.assertion} `));
    const others = [...new Set(failures.map((f) => f.split(" — ")[0]!).filter((a) => a !== control.assertion))];
    failures.unshift(
      named
        ? `control ${control.name}: failed on ${control.assertion}, as it must${others.length === 0 ? ", and on nothing else" : `; ALSO failed on ${others.join(", ")}`}`
        : `control ${control.name}: did NOT fail on ${control.assertion}, so the check can't see what the control removes`,
    );
  }
  return {
    failures,
    evidence: `legs ${[...legs].join(", ")} on the DevTeam install, ${model} for the turns; Alice ${alice.userId}, Bob ${bob.userId}, Alice's second org ${SECOND_ORG.orgId}`,
  };
});
