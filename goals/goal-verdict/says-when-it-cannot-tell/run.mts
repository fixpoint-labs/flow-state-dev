/**
 * Goal check — a goal check that can't see says so.
 *
 * Model-free. See goal.md for the contract.
 * Control: `GOAL_CONTROL=length-guard` must FAIL the blind leg and the sweep.
 *
 * Run: pnpm tsx goals/goal-verdict/says-when-it-cannot-tell/run.mts
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANT_TELL_EXIT, KITCHEN_SINK, goalTmpDir, loadFixture, runGoal, runHarness } from "../../lib/index.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROL !== "length-guard") throw new Error(`unknown GOAL_CONTROL=${CONTROL}`);

const GOALS = fileURLToPath(new URL("../..", import.meta.url));
const VERDICT = fileURLToPath(new URL("../../lib/verdict.mts", import.meta.url));
const fixture = loadFixture<{ request: string }>(import.meta.url, "request.json");

/** The assertion each probe leg names, and the field it reads. */
const BLIND = { dir: "blind-leg", field: "seq", name: "ordering · persisted items' seq" };
const SIGHTED = { dir: "sighted-leg", field: "itemIndex", name: "ordering · persisted items' itemIndex" };

/** One probe leg. `guarded` is the length-guard control. */
function legSource(leg: typeof BLIND, guarded: boolean): string {
  const raw = `items.map((i) => i[${JSON.stringify(leg.field)}]).filter((v): v is number => typeof v === "number")`;
  const read = guarded ? raw : `tell.over(${JSON.stringify(leg.name)}, ${raw})`;
  const guard = guarded ? "values.length > 0 && " : "";
  return [
    `import { readFileSync } from "node:fs";`,
    `import { runGoal } from ${JSON.stringify(VERDICT)};`,
    `const items: Array<Record<string, unknown>> = JSON.parse(readFileSync(process.env.GOAL_ITEMS!, "utf8"));`,
    `const nonDecreasing = (xs: number[]) => xs.every((x, i) => i === 0 || xs[i - 1]! <= x);`,
    `await runGoal(async (failures, tell) => {`,
    `  const values = ${read};`,
    `  if (${guard}!nonDecreasing(values)) failures.push("ordering: ${leg.field} is not non-decreasing");`,
    `  return { failures, evidence: "persisted items in order by ${leg.field}" };`,
    `});`,
    ``,
  ].join("\n");
}

interface Ran {
  exit: number | null;
  output: string;
}

function run(args: string[], env: Record<string, string>): Ran {
  const r = spawnSync("pnpm", args, { cwd: GOALS, encoding: "utf8", env: { ...process.env, ...env } });
  return { exit: r.status, output: `${r.stdout}${r.stderr}` };
}

await runGoal(async (failures, tell) => {
  // 1. The real run's persisted items.
  const observed = runHarness<{ ok: boolean; reason?: string; status?: string; items?: unknown[] }>({
    app: KITCHEN_SINK,
    harness: new URL("./harness.mts", import.meta.url),
    env: { FSD_ENV: "dev", KS_GOAL_REQUEST: fixture.request },
  });
  if (observed.ok !== true) return { failures: [observed.reason ?? "driver reported failure"], evidence: "" };
  const items = tell.over("the suspension run's persisted items", observed.items ?? []);
  if (observed.status !== "suspended") failures.push(`setup: the run ended "${observed.status}", not suspended at its gate`);

  // 2. The probe tree: two goals, each grading the same items.
  const tree = join(goalTmpDir("goal-verdict"), "tree");
  const itemsFile = join(tree, "..", "items.json");
  writeFileSync(itemsFile, JSON.stringify(items));
  for (const leg of [BLIND, SIGHTED]) {
    mkdirSync(join(tree, leg.dir), { recursive: true });
    writeFileSync(join(tree, leg.dir, "goal.md"), `# goal-verdict probe › it ${leg.dir}\n\n**Model:** n/a\n`);
    writeFileSync(join(tree, leg.dir, "run.mts"), legSource(leg, leg === BLIND && CONTROL === "length-guard"));
  }
  const env = { GOAL_ITEMS: itemsFile };

  // 3a. Each leg on its own: its verdict line and exit code.
  const blind = run(["tsx", join(tree, BLIND.dir, "run.mts")], env);
  console.log(`blind leg (exit ${blind.exit}):\n${blind.output.trim()}`);
  if (blind.exit !== CANT_TELL_EXIT || !blind.output.includes(`CAN'T TELL —\n  - ${BLIND.name}: read 0`) || blind.output.includes("PASS —")) {
    failures.push(`the blind leg says CAN'T TELL: it exited ${blind.exit} and printed ${JSON.stringify(blind.output.trim().slice(0, 300))}`);
  }
  const indexed = items.filter((i) => typeof (i as Record<string, unknown>)[SIGHTED.field] === "number").length;
  const sighted = run(["tsx", join(tree, SIGHTED.dir, "run.mts")], env);
  console.log(`sighted leg (exit ${sighted.exit}):\n${sighted.output.trim()}`);
  if (sighted.exit !== 0 || !sighted.output.includes(`PASS — persisted items in order by ${SIGHTED.field} · read: ${SIGHTED.name}: ${indexed}`)) {
    failures.push(`the sighted leg says PASS and names what it read (${indexed} items): it exited ${sighted.exit} and printed ${JSON.stringify(sighted.output.trim().slice(0, 300))}`);
  }

  // 3b. The sweep over both: the blind leg is listed apart, and is not passed.
  const sweep = run(["goal:all", `--root=${tree}`], env);
  const summary = sweep.output.slice(sweep.output.lastIndexOf("GOAL SWEEP SUMMARY"));
  console.log(`sweep (exit ${sweep.exit}):\n${summary.trim()}`);
  if (!summary.includes(`CAN'T TELL  ${BLIND.dir}`) || !summary.includes("1/2 passed, 1 can't tell") || sweep.exit === 0) {
    failures.push(`the sweep counts the blind leg as CAN'T TELL, not passed: it exited ${sweep.exit} with ${JSON.stringify(summary.trim())}`);
  }
  if (!summary.includes(`PASS  ${SIGHTED.dir}`)) failures.push(`the sweep counts the sighted leg as PASS: ${JSON.stringify(summary.trim())}`);

  return {
    failures,
    evidence:
      `on a real suspended requestApproval run, the leg reading "${BLIND.field}" (not on persisted items) said CAN'T TELL with exit ${CANT_TELL_EXIT}, ` +
      `the leg reading "${SIGHTED.field}" said PASS naming ${indexed} items read, and goal:all listed them CAN'T TELL and PASS and exited ${sweep.exit}`,
  };
});
