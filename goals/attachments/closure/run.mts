/**
 * The attachments closure (FIX-2565, epic FIX-2516): every chat in our apps
 * takes images and documents. See goal.md.
 *
 * Runs each app's legs (`<app>/run.mts`: Kitchen Sink's four chats, Shift
 * Manager, the Claude Code-style lab, the Teammates lab) one after another,
 * then the model-free sweeps (`sweeps/run.mts`), and reports one verdict:
 * PASS only when every app and the sweeps passed. Each part is also runnable
 * on its own.
 *
 * Run:  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/attachments/closure/run.mts
 *       --sweeps-only                  the model-free sweeps alone
 *       GOAL_APPS=kitchen-sink,teammates  a subset of the apps
 *       GOAL_CONTROL=strip-file-parts  legs a and b must FAIL on names-both and code-word in every app
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, runGoal } from "../../lib/index.mts";
import { refuseStubs } from "./legs.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const APPS = ["kitchen-sink", "shift-manager", "claude-code-style", "teammates"] as const;
const sweepsOnly = process.argv.includes("--sweeps-only");
const asked = (process.env.GOAL_APPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const unknown = asked.filter((a) => !(APPS as readonly string[]).includes(a));
if (unknown.length > 0) {
  console.error(`unknown GOAL_APPS ${unknown.join(", ")}; known: ${APPS.join(", ")}`);
  process.exit(2);
}
if (!sweepsOnly) refuseStubs();
const parts = [...(sweepsOnly ? [] : asked.length > 0 ? asked : APPS), "sweeps"];

await runGoal((failures, tell) => {
  const passed: string[] = [];
  for (const part of tell.over("closure · parts run", parts)) {
    console.error(`\n=== ${part}`);
    // The sweeps carry their own controls; the app control is for the legs.
    const env = part === "sweeps" ? { ...process.env, GOAL_CONTROL: "" } : process.env;
    const run = spawnSync("pnpm", ["tsx", join(HERE, part, "run.mts")], { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    process.stderr.write(run.stderr ?? "");
    process.stderr.write(run.stdout ?? "");
    // The verdict may go to either stream.
    const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    const verdict = out.split("\n").find((line) => /^(PASS|FAIL|CAN'T TELL) —/.test(line)) ?? `no verdict (exit ${run.status})`;
    if (run.status === 0) passed.push(part);
    else {
      const bullets = out.split("\n").filter((line) => line.startsWith("  - "));
      failures.push(`${part}: ${verdict.slice(0, 120)}`, ...bullets.map((b) => `${part} ${b.trim().slice(2)}`));
    }
  }
  return { failures, evidence: `passed: ${passed.join(", ")}` };
});
