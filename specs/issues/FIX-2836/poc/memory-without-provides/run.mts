/**
 * POC check (FIX-2836): memory reaches another kit's flows with no `provides`.
 *
 * a · real workforce: after start-up, workforce's `agent` worker flow carries
 *     memory's resources, from the app's fill of `workforce.slots.uses`.
 * b · runtime, through `fsdev run`: a block in a kit that knows nothing about
 *     memory calls `ctx.cap.workingMemory`, and its writes read back.
 *
 * Run (from the repo root): packages/fsdev/node_modules/.bin/tsx specs/issues/FIX-2836/poc/memory-without-provides/run.mts
 * Control that must fail both legs: POC_CONTROL=no-fill
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "../../../../..");
const TSX = join(REPO, "packages/fsdev/node_modules/.bin/tsx");
const FSDEV = join(REPO, "packages/fsdev/bin/fsdev.ts");

// A developer's model overrides would refuse a start that never calls a model.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("FSDEV_")));
const failures: string[] = [];

// a · the real workforce kit, started in-process.
process.env.POC_CONTROL = env.POC_CONTROL;
for (const key of Object.keys(process.env)) if (key.startsWith("FSDEV_")) delete process.env[key];
const app = (await import("./app.mts")).default;
await app.ready();
const runtime = (await app.getRuntime()) as unknown as { registry: { get(id: string): { resources?: Record<string, unknown> } | undefined } };
const agentResources = Object.keys(runtime.registry.get("agent")?.resources ?? {});
const memoryOnAgent = agentResources.filter((key) => ["workingMemory", "memorySystem"].includes(key));
console.log(`a · workforce agent flow's memory resources: ${JSON.stringify(memoryOnAgent)}`);
if (memoryOnAgent.length !== 2) failures.push(`a · the agent flow should carry workingMemory and memorySystem, got ${JSON.stringify(memoryOnAgent)}`);
await app.dispose();

// b · fsdev run against the same app: a block in the stand-in kit uses memory through ctx.cap.
const capture = join(mkdtempSync(join(tmpdir(), "fix-2836-run-")), "remember.json");
const ran = spawnSync(TSX, [FSDEV, "run", "team", "remember", "--input", "{}", "--config", join(HERE, "app.mts"), "--capture", capture, "--quiet"], {
  cwd: HERE,
  env,
  encoding: "utf8",
});
if (ran.status !== 0) {
  failures.push(`b · fsdev run team remember failed (exit ${ran.status}): ${`${ran.stderr}${ran.stdout}`.slice(-400)}`);
} else {
  const output = JSON.parse(readFileSync(capture, "utf8")).result?.output as { capabilities?: string[]; entries?: string[] };
  console.log(`b · ctx.cap: ${JSON.stringify(output.capabilities)}; working memory read back: ${JSON.stringify(output.entries)}`);
  if (!output.entries?.includes("the user prefers short answers") || output.entries.length !== 2) {
    failures.push(`b · both writes should read back, got ${JSON.stringify(output.entries)}`);
  }
}

if (failures.length > 0) {
  console.log(`FAIL\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log("PASS");
