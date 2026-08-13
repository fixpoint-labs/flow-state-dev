// CONTROL A — synthetic violations. Every rule must fire at least once here.
// If any rule reports 0 on this file, that rule is dead and its repo count is
// meaningless. The concept is encoded THREE ways and each gets coverage:
//   E1 identifiers carrying the `work` token
//   E2 string-literal union members spelling "work"
//   E3 the word `background` used for the tier-2 concept

declare const seq: any;

// --- E1: identifiers ---------------------------------------------------------

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

// R3: work-token identifiers, including the ones a six-name list missed
import type {
  RequestWorkPool,
  RequestWorkPoolResult,
  RequestWorkPoolDrainOptions,
  RequestWorkPoolDrainAllOptions,
  RequestWorkTaskMeta,
  WorkConfig,
  WorkTrace,
} from "@flow-state-dev/core";
declare function getRequestWorkPool(): RequestWorkPool;
declare function createRequestWorkPool(): RequestWorkPool;
type FakeSequencerResult = { workResults: WorkTrace[] };

// --- E2: string-literal union members ---------------------------------------

// R2: provenance phase literal, in all three shapes
type FakeProvenance = {
  phase: "main" | "work"; // union member
  workGroupId?: string; // R4
};
const prov = { phase: "work" as const }; // property assignment
const isWork = prov.phase === "work"; // comparison
const ternary = { phase: cond ? "work" : "main" }; // conditional feeding phase

// R7: a "work" union member NOT attached to `phase`. This is the encoding that
// slipped past the original sweep — FlowErrorScope is publicly exported and a
// phase-only rule cannot see it.
type FakeErrorScope = "request" | "work" | "resource" | "block";
declare const execMeta: { scope?: FakeErrorScope };

// --- E3: `background` naming the tier-2 concept ------------------------------

// R8: a work-token rule cannot match these by construction.
declare function composeBackgroundSignal(s: AbortSignal): AbortSignal;
declare const ctxLike: { _requestBackgroundSignal?: AbortSignal };
const status = { message: "hi", backgroundTasks: 3 }; // R5

// --- E4: runtime path/name literals (become checkpoint keys) -----------------

// R9: these are not identifiers, not union members, not `background` names.
// Renaming them changes blockInstanceId -> the checkpoint key.
declare function childBlockPath(ctx: any, rt: any, op: string, i: number, j?: number): string;
const p1 = childBlockPath(null, null, "work", 0);
const p2 = childBlockPath(null, null, "workIf", 1);
const p3 = childBlockPath(null, null, "forEachBackground", 2, 0);
const cfgA = { name: "forEachBackground" };
const cfgB = { name: `work:${(someBlock as any).name}` };

declare const someBlock: unknown;
declare const cond: boolean;
