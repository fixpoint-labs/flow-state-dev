/**
 * Goal check — FIX-827: Plan & Execute carries concrete task context to workers.
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/plan-and-execute/carries-original-data-to-workers/run.mts
 *
 * One thing to wire before the first run: <flow> <action> must be an app
 * flow that composes `planAndExecute` (e.g. a kitchen-sink flow). The
 * assertion logic below is complete and does not depend on which flow it is.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MODEL = "openai/gpt-5.4-mini";
const FLOW = "<flow>"; // TODO: app flow that composes planAndExecute
const ACTION = "<action>"; // TODO: the action that runs it

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/subdomains.json", import.meta.url), "utf8"),
) as { request: string; subdomains: string[] };

// Drive the real path with a real model; capture the full NDJSON stream + result.
execFileSync(
  "pnpm",
  [
    "fsdev", "run", FLOW, ACTION,
    "-i", JSON.stringify({ message: `${fixture.request}\n\n${fixture.subdomains.join("\n")}` }),
    "--model", MODEL,
    "--capture", "/tmp/fix-827-goal.json",
  ],
  { stdio: "inherit" },
);

// `fsdev run --capture` writes { command, events, result }. The item stream is
// the `item_added` events; the final action output is on `result`.
const captured = JSON.parse(readFileSync("/tmp/fix-827-goal.json", "utf8"));
if (captured.result?.success !== true) {
  console.error(`FAIL — flow did not complete: ${JSON.stringify(captured.result?.error ?? "unknown")}`);
  process.exit(1);
}
const items: any[] = (captured.events ?? [])
  .filter((e: any) => e.type === "item_added")
  .map((e: any) => e.item);

// Grade against the fixture — never against hardcoded names.
const failures: string[] = [];

// 1. Each worker's context must carry its subdomain. Workers are dispatched
//    with a `context` field on the task; find the worker inputs in the stream.
const workerContexts: string[] = items
  .filter((i) => i.type === "block_output" && i.output?.context != null)
  .map((i) => String(i.output.context));

for (const sub of fixture.subdomains) {
  const reached = workerContexts.some((ctx) => ctx.includes(sub));
  if (!reached) failures.push(`subdomain never reached a worker's context: ${sub}`);
}

// 2. The final answer must name most of the specific subdomains — proving the
//    data shaped the output, not just the plan. Assistant messages only
//    (role !== "user"), plus the action's final output.
const finalText = [
  ...items
    .filter((i) => i.type === "message" && i.role !== "user")
    .map((i) => String(i.content ?? i.text ?? "")),
  JSON.stringify(captured.result?.output ?? ""),
].join("\n");
const named = fixture.subdomains.filter((s) => finalText.includes(s)).length;
if (named < 4) {
  failures.push(`final answer named only ${named}/${fixture.subdomains.length} subdomains (need >= 4)`);
}

if (failures.length === 0) {
  console.log(
    `PASS — all ${fixture.subdomains.length} subdomains reached worker context; ` +
      `${named}/${fixture.subdomains.length} named in the final answer.`,
  );
  process.exit(0);
} else {
  console.error("FAIL —\n" + failures.join("\n"));
  process.exit(1);
}
