// LAB-140 end-state POC — drives the assembled sketch and prints what the seams do.
//
//     pnpm tsx spec-poc/LAB-140-end-state/run.ts
//     pnpm tsc -p spec-poc/LAB-140-end-state/tsconfig.json   # the alias question
//
// Throwaway. Never merges. Not for code review.
import { testBlock } from "@flow-state-dev/testing";
import type { HarnessBlock, HarnessBlockBySchema } from "./contract";
import { claudeCodeAgent } from "./claude-harness";
import { codexAgent } from "./codex-harness";
import { board, claudeManager, codexManager, seedRow, HARNESSES } from "./compose";
import { world, sleep } from "./world";

// --- the alias question (LAB-152 §13): which spelling does an EXTENDED handle fit? ---
type Fits<T extends HarnessBlock> = T;
type _claudeFits = Fits<ReturnType<typeof claudeCodeAgent>>;
type _codexFits = Fits<ReturnType<typeof codexAgent>>;
// @ts-expect-error — the schema-typed spelling rejects an extended output schema.
const _bySchema: HarnessBlockBySchema = claudeCodeAgent({ detached: true });

const attempt = (taskId: string, attempts: number, feedback?: string) =>
  ({ taskId, goal: `implement ${taskId}`, attempts, ...(feedback ? { feedback } : {}) });
const run = (manager: typeof claudeManager, input: ReturnType<typeof attempt>) =>
  testBlock(manager, { input }).then((r) => r.output, (e: Error) => `threw: ${e.message}`);

async function main() {
process.env.NODE_ENV = "test"; // quiets the engine's per-block execution log; the transcript is ours
console.log("\n== A. Claude Code under the manager: an answered run CONTINUES its session");
world.reset();
await run(claudeManager, attempt("LAB-1", 1));
await run(claudeManager, attempt("LAB-1", 2, "answer: keep the symlink"));
const a = world.rows.get("LAB-1")!;
console.log(`  => attempt 2 resumed ${a.sessionId}; source=${a.source}; cost basis=${a.cost?.basis}`);

console.log("\n== B. Codex under the SAME manager: the deadline kills a run mid-command");
world.reset();
await run(codexManager, attempt("LAB-2", 1));
const releasedAt = world.locks.size === 0 ? Date.now() - world.t0 : null;
await sleep(200); // let "the command the model ran" finish on its own
const late = world.treeWrites.filter((w) => w.by === "thr_1" && w.at - world.t0 > (releasedAt ?? Infinity)).length;
console.log(`  => row.sessionId=${world.rows.get("LAB-2")!.sessionId} survived the kill (the hook wrote it first)`);
console.log(`  => FINDING: ${late} checkout writes by thr_1 landed AFTER the lease was released at ~${releasedAt}ms`);
await run(codexManager, attempt("LAB-2", 2));
const b = world.rows.get("LAB-2")!;
console.log(`  => attempt 2 resumed ${b.sessionId}; source=${b.source}; cost=${b.cost ? `${b.cost.usd.toFixed(5)} ${b.cost.basis}` : "null"}`);

console.log("\n== C. One board, two assignees, one manager package");
console.log(`  board constructed (${typeof board}) with workers: ${HARNESSES.join(" · ")} — two managers, one package`);
console.log(`  seed(LAB-3, codex) → ${JSON.stringify(seedRow("LAB-3", "codex"))}`);
console.log("  A detached board fixes `assignee` at admission (task-board/index.ts, FIX-982 d10),");
console.log("  so a row never changes harness between attempts; `source` on the row has no case here.");
console.log("\ndone.");
}
void main();
