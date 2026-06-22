/**
 * Goal check runner — real model, real path, out of CI.
 *
 * Copy this with the goal folder. Replace the flow/action and the
 * assertions. The shape stays the same: drive the real path, pull the
 * concrete facts out of the fixture, assert they survived into the
 * user-visible output, print an explicit PASS/FAIL, exit non-zero on FAIL.
 *
 * Run: pnpm tsx goals/<id>-<slug>/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MODEL = "openai/gpt-5.4-mini";

// 1. Load the held-out fixture. Nothing below should hardcode its contents.
// const input = JSON.parse(readFileSync(new URL("./fixtures/input.json", import.meta.url), "utf8"));

// 2. Drive the REAL path with a REAL model, capturing the run.
// execFileSync("pnpm", [
//   "fsdev", "run", "<flow>", "<action>",
//   "-i", JSON.stringify(input),
//   "--model", MODEL,
//   "--capture", "/tmp/goal-run.json",
// ], { stdio: "inherit" });
// const result = JSON.parse(readFileSync("/tmp/goal-run.json", "utf8"));

// 3. Assert on the user-visible surface, graded against the fixture.
//    NOT on an internal function's return value.
const failures: string[] = [];
// e.g. for (const fact of factsFrom(input)) {
//   if (!outputContains(result, fact)) failures.push(`missing: ${fact}`);
// }

// 4. Explicit verdict.
if (failures.length === 0) {
  console.log("PASS — <evidence inspected>");
  process.exit(0);
} else {
  console.error("FAIL —\n" + failures.join("\n"));
  process.exit(1);
}
