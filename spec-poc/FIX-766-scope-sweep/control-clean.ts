// CONTROL B — correct post-rename code plus near-miss decoys.
// Every rule must report ZERO on this file. A rule that fires here over-counts
// the repo sweep (it is matching neighbours of the claim, not the claim).

declare const seq: any;

// Post-rename DSL — must NOT fire
seq.sideChain(someBlock);
seq.sideChainIf(cond, someBlock);
seq.waitForSideChain({ timeoutMs: 1000 });
seq.forEachSideChain(someBlock);

interface RenamedSequencer {
  sideChain(b: unknown): RenamedSequencer;
  waitForSideChain(o?: unknown): RenamedSequencer;
}

// Post-rename provenance / contract — must NOT fire
type RenamedProvenance = {
  phase: "main" | "sideChain";
  sideChainGroupId?: string;
};
const prov = { phase: "sideChain" as const };
type RenamedErrorScope = "request" | "sideChain" | "resource" | "block";
declare function composeSideChainSignal(): AbortSignal;
const status = { message: "hi", sideChainTasks: 3 };
type SideChainTrace = { blockName: string };
type RenamedSequencerResult = { sideChainResults: SideChainTrace[] };

// ---------------------------------------------------------------------------
// DECOYS THAT MUST SURVIVE THE RENAME.
// These are the regressions an over-eager codemod actually causes. If any rule
// fires below, the guard would be telling an implementer to rename a name that
// is already correct — a worse outcome than missing one.
// ---------------------------------------------------------------------------

// Tier 3 — a different tier, and the word it should keep.
type Workstream = { id: string };
declare const workstreams: Workstream[];
declare function listWorkstreams(sessionId: string): Promise<Workstream[]>;
type WorkstreamRef = { key: string };

// `prior work` = a task's previously-completed output. Different concept.
type TaskPriorWork = { summary: string };
declare function formatPriorWork(p: TaskPriorWork): string;
const taskInput = { priorWork: [] as TaskPriorWork[] };

// The serverless keep-alive hook. Covers ALL work outliving the response, so
// under this change it IS the umbrella term and is already named correctly.
const runtimeConfig = { onBackgroundWork: (p: Promise<unknown>) => void p };

// The two OTHER `phase` fields in this repo — same name, different meaning.
// A textual grep for `phase` conflates all three; the AST rule must not.
type BlockTraceCapturePhase = "added" | "input" | "output" | "generator";
const capture = { phase: "added" as BlockTraceCapturePhase };
const validation = { phase: "stream" as "stream" | "final" };

// Bare-substring decoys: these do NOT carry the `work` token once split on
// case boundaries, so no rule may fire on them.
const misc = { network: 1, framework: 2, teamwork: 3 };
const label = "work"; // a bare string, not a union member and not bound to phase

// NOTE — deliberately NOT here: `workQueue`, `doWork`. Those genuinely DO carry
// the `work` token, and R3 flags them. That is correct: R3 is a broad TRIAGE
// rule that surfaces candidates for a human to classify, not a precise rename
// list. Its repo number is a review queue, not a count of sites to change.
// Putting them in this file would have asserted a precision R3 does not have.

declare const someBlock: unknown;
declare const cond: boolean;
