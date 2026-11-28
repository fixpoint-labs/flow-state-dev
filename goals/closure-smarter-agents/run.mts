import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { goalTmpDir } from "../lib/paths.mts";
import { ALL_APPS } from "./asks.mts";

function run(part: string, env = process.env): number {
  const file = fileURLToPath(new URL(`./${part}/run.mts`, import.meta.url));
  const child = spawnSync(process.execPath, [...process.execArgv, file], { env, stdio: "inherit" });
  if (child.error !== undefined) throw child.error;
  return child.status ?? 1;
}

const graders = run("graders");
if (graders !== 0 || process.env.GOAL_GRADERS_ONLY === "1") process.exit(graders);

const env = { ...process.env, GOAL_PASS: process.env.GOAL_PASS ?? "wrap", GOAL_SHEETS: goalTmpDir("closure-sheets") };
if (env.GOAL_PASS !== "control" && env.GOAL_PASS !== "cut" && env.GOAL_PASS !== "wrap") {
  throw new Error(`unknown GOAL_PASS "${env.GOAL_PASS}"`);
}
const appStatuses = ALL_APPS.map((app) => run(app, env));
const verdict = run("verdict", env);
// Control and cut grade the complete set of sheets, including individual red runs.
process.exit(verdict !== 0 ? verdict : env.GOAL_PASS === "wrap" && appStatuses.some((status) => status !== 0) ? 1 : 0);
