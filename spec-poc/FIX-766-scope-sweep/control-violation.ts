// CONTROL A — synthetic violations. Every rule must fire at least once here.
// If any rule reports 0 on this file, that rule is dead and its repo count is meaningless.

declare const seq: any;

// R1: all four DSL methods, as call sites
seq.work(someBlock);
seq.workIf(cond, someBlock);
seq.waitForWork({ timeoutMs: 1000 });
seq.forEachBackground(someBlock);

// R1b: declaration sites
interface FakeSequencer {
  work(b: unknown): FakeSequencer;
  waitForWork(o?: unknown): FakeSequencer;
}

// R2: provenance phase literal, in all three shapes
type FakeProvenance = {
  phase: "main" | "work"; // union member
  workGroupId?: string; // R4
};
const prov = { phase: "work" as const }; // property assignment
const isWork = prov.phase === "work"; // comparison
const ternary = { phase: cond ? "work" : "main" }; // conditional feeding phase

// R3: the six public exports
import type {
  RequestWorkPool,
  RequestWorkPoolResult,
  RequestWorkPoolDrainOptions,
  RequestWorkPoolDrainAllOptions,
  RequestWorkTaskMeta,
} from "@flow-state-dev/core";
declare function getRequestWorkPool(): RequestWorkPool;

// R5: status item field
const status = { message: "hi", backgroundTasks: 3 };

declare const someBlock: unknown;
declare const cond: boolean;
