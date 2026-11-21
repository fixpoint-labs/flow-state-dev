/** Goal: a kit-installed answer is held until its independent review completes. */
import { resolveItemVisibility, type RuntimeItem } from "@flow-state-dev/core/items";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPatched, describePatches, goalTmpDir, modulePatchEnv, readCapture, REPO_ROOT, runGoal, type ModulePatch } from "../../lib/index.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CONFIG = join(HERE, "fixture/fsdev.config.mts");
const TMP = goalTmpDir("second-opinion-checks-before-showing");
const CAPTURE = join(TMP, "capture.json");
const CALL_LOG = join(TMP, "calls.log");
const MARK = join(TMP, "patched.txt");
const MODULE = "packages/patterns/src/second-opinion/index.ts";
const CONTROLS: Record<string, ModulePatch[]> = {
  "show-draft": [{ module: MODULE, from: "const hidden = \\{ client: false, history: false \\}", to: "const hidden = { client: true, history: false }" }],
  "one-model": [{ module: MODULE, from: "model: config\\.draftModel,", to: "model: config.reviewModel," }],
};
const control = process.env.GOAL_CONTROL;
if (control !== undefined && CONTROLS[control] === undefined) throw new Error(`unknown GOAL_CONTROL ${control}`);
const patches = control === undefined ? [] : CONTROLS[control]!;
if (control !== undefined) console.error(`control ${control}:\n${describePatches(patches, REPO_ROOT)}`);
const env = control === undefined ? {} : modulePatchEnv(patches, REPO_ROOT, MARK);
const tsx = join(REPO_ROOT, "packages/fsdev/node_modules/.bin/tsx");
const fsdev = join(REPO_ROOT, "packages/fsdev/bin/fsdev.ts");
const ran = spawnSync(tsx, [fsdev, "run", "second-opinion", "ask", "--input", JSON.stringify({ message: "What is the safe answer?" }), "--config", CONFIG, "--capture", CAPTURE], {
  cwd: HERE,
  env: { ...process.env, ...env, CALL_LOG },
  encoding: "utf8",
});

await runGoal((failures, tell) => {
  if (ran.status !== 0) failures.push(`app:run · exit ${ran.status}: ${(ran.stderr ?? "").slice(-600)}`);
  const calls = tell.over("models:calls", readFileSync(CALL_LOG, "utf8").trim().split("\n").filter(Boolean));
  const ids = calls.map((line) => line.split("|")[0]);
  if (!ids.includes("scripted/draft") || !ids.includes("scripted/review")) failures.push(`models:two · expected draft and review models, got ${JSON.stringify(ids)}`);
  const blocks = calls.map((line) => line.split("|")[1]);
  const synth = blocks.indexOf("second-opinion-synthesizer");
  for (const required of ["second-opinion-debater-critic", "second-opinion-analyzer"]) {
    const at = blocks.indexOf(required);
    if (at < 0 || synth < 0 || at > synth) failures.push(`order:check-before-show · ${required} must run before synthesis; ${JSON.stringify(blocks)}`);
  }
  let clientItems: Array<Record<string, unknown>> = [];
  if (ran.status === 0) {
    const capture = readCapture(CAPTURE);
    clientItems = capture.items.filter(
      (item) => resolveItemVisibility(item as RuntimeItem).client,
    ) as Array<Record<string, unknown>>;
  }
  tell.over("client:items", clientItems);
  const visible = JSON.stringify(clientItems);
  if (!visible.includes("FINAL_MARKER")) failures.push(`client:final · final answer not visible: ${visible}`);
  if (visible.includes("DRAFT_MARKER") || visible.includes("CRITIQUE_MARKER")) failures.push(`client:hidden · draft or critique was shown: ${visible}`);
  if (visible.includes("debate-verdict") || visible.includes("audit-annotation")) failures.push(`client:annotations · internal verdict or audit was shown: ${visible}`);
  if (control !== undefined) assertPatched(patches, REPO_ROOT, MARK);
  return { failures, evidence: `calls ${JSON.stringify(calls)}\nclient items ${visible}` };
});
