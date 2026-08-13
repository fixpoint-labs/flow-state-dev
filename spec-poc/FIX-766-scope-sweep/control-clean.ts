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

// Post-rename provenance — must NOT fire
type RenamedProvenance = {
  phase: "main" | "sideChain";
  sideChainGroupId?: string;
};
const prov = { phase: "sideChain" as const };

// DECOYS: the two OTHER `phase` fields in this repo, which share the name but
// not the meaning. A textual grep for `phase` conflates all three; the AST rule
// must not.
type BlockTraceCapturePhase = "added" | "input" | "output" | "generator";
const capture = { phase: "added" as BlockTraceCapturePhase };
const validation = { phase: "stream" as "stream" | "final" };

// DECOY: the bare word "work" in contexts unrelated to the rename
const label = "work"; // a string that happens to be the word
const workQueue: string[] = []; // an identifier containing "work"
function doWork(): void {} // a function whose name contains "Work"
const teamwork = { network: 1, framework: 2 }; // substrings of "work"

// DECOY: renamed exports — must NOT fire
declare function getRequestSideChainPool(): unknown;

// DECOY: renamed status field
const status = { message: "hi", sideChainTasks: 3 };

declare const someBlock: unknown;
declare const cond: boolean;
