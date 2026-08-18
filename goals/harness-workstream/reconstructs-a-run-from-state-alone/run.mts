/**
 * Goal check — harness-workstream › it reconstructs a run from state alone.
 *
 * Dispatches a REAL coding run into a workstream, then hands a reader nothing
 * but this system's own HTTP routes and asks it what the run did. Only after
 * the account exists is it compared, field by field, against the expectation
 * the run was given.
 *
 * That inversion is the point: `reader.mts` never sees the expectation, and
 * `grader.mts` never sees the routes.
 *
 * **`goal.md` is the contract** — the outcome, the eight assertions, the
 * anti-game, what this deliberately does not re-assert, and the verdict log.
 * This file holds the mechanism and the reasons a reader of the CODE needs, and
 * does not restate it.
 *
 * Two preconditions abort rather than grade: the model-free calibration below,
 * which includes every guard case so a broken grader costs no coding run; and
 * the run having actually finished with the routes answering.
 *
 * Run: pnpm tsx goals/harness-workstream/reconstructs-a-run-from-state-alone/run.mts
 */
import { deepStrictEqual } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  claudeCodeAgent,
  OBSERVED_FILE_OPS,
  OBSERVED_GAPS,
  OBSERVED_PLAN,
} from "@flow-state-dev/claude-code/sdk";
import { defineTaskCollection, type TaskWorker } from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { fixturePath, loadFixture, runGoal, silentLogger } from "../../lib/index.mts";
import { readAccount, type Account, type Read } from "./reader.mts";
import { failuresOf, grade, type Expectation, type Finding, type FindingStatus } from "./grader.mts";

interface Fixture {
  topic: string;
  /** Files the run is asked to create. */
  createPaths: string[];
  /** An existing file the run is asked to edit. */
  editPath: string;
  seedContent: string;
  planItemCount: number;
}

/** The three collections the reader must read. A2 and A7 both depend on all three. */
const COLLECTIONS = [OBSERVED_FILE_OPS, OBSERVED_GAPS, OBSERVED_PLAN];

/**
 * The deprived surface assertion 8 grades, and what each file may import.
 *
 * **Both files, not just the reader.** A local module the reader imports is a
 * second way to reach the filesystem, so `paths.mts` is held to a stricter rule
 * than the reader: it may import nothing at all.
 *
 * The reader's one allowance is the three collection accessor keys — the route
 * addresses it reads. Sharing them with the package that writes them is
 * correct; a second copy would answer 404 the day one is renamed. Everything
 * else, node builtins above all, is a failure: an allowlist rather than a deny
 * list, so a module nobody thought to forbid is still caught.
 */
const DEPRIVED_MODULES: Array<{ file: string; mayImport: string[] }> = [
  { file: "reader.mts", mayImport: ["@flow-state-dev/claude-code/sdk", "./paths.mts"] },
  { file: "paths.mts", mayImport: [] },
];

const BOARD_ID = "harness-coding";
const FLOW_KIND = "harness-coding";
const ASSIGNEE = "implement";
const USER_ID = "goal-user";
/** Fresh per invocation, so the workstream this reads holds only this run. */
const PARENT_SESSION_ID = `sess_state_readback_${Date.now()}`;

const RUN_TIMEOUT_MS = Number(process.env.GOAL_RUN_TIMEOUT_MS ?? 300_000);
const POLL_INTERVAL_MS = 2_000;

type WorkstreamRow = { id: string; parentSessionId?: string; topic?: string; status?: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Strip comments so the scanner reads code, never the prose about the code. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Every module specifier a source file's own code imports, comments stripped.
 *
 * Comment-stripping is load-bearing, not tidiness: the deprived files' headers
 * discuss what they must not import, and a scanner that read prose would be
 * permanently red for the wrong reason — which is how a guard gets deleted.
 * Covers `from "x"`, bare `import "x"`, dynamic `import("x")` and `require("x")`.
 */
export function importsOf(source: string): string[] {
  const code = codeOf(source);
  const found = new Set<string>();
  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']/g,
  ]) {
    for (const match of code.matchAll(pattern)) found.add(match[1]);
  }
  return [...found].sort();
}

/**
 * The ways out that are NOT an import statement, which an allowlist of module
 * specifiers cannot see.
 *
 * A list of permitted module names is only half a deprivation guard.
 * `process.cwd()` needs no import at all, and a dynamic import whose specifier
 * is a template literal or a concatenation carries no string for the scanner to
 * match. Either would be a reader reaching the filesystem while assertion 8
 * reported it clean — this epic's exact failure class, in the check that exists
 * to rule it out.
 */
export function escapesOf(source: string): string[] {
  const code = codeOf(source);
  const found = new Set<string>();
  for (const name of ["process", "globalThis", "require", "eval"]) {
    if (new RegExp(`\\b${name}\\b`).test(code)) found.add(name);
  }
  // `import(` not followed by a quoted literal: the specifier is computed, so
  // no allowlist can say what it resolves to.
  if (/\bimport\s*\(\s*[^"'\s)]/.test(code)) found.add("import(<computed>)");
  return [...found].sort();
}

/**
 * Why a route read failed, as a **kind** rather than a sentence.
 *
 * 403 and 404 mean opposite things — the collection declining to publish its
 * state, versus a reference this file got wrong — and a reader who is handed the
 * wrong one chases the wrong thing. The kind is what the self-check asserts on:
 * an earlier version matched the substring `"permission"` against a message that
 * reads *"NOT a permission problem"*, so the check was true of every input. A
 * check that passes regardless of what it examines, inside the layer whose job
 * is catching checks that pass regardless of what they examine.
 */
export type ReadFailure = { kind: "permission" | "wrong-reference" | "other"; message: string };

export function describeReadFailure(status: number, path: string, body: string): ReadFailure {
  if (status === 403) {
    return {
      kind: "permission",
      message:
        `GET ${path} returned 403 — the collection does not declare client state reads, so the ` +
        `reader cannot work at all. Aborting before grading rather than reading it as "no rows"`,
    };
  }
  if (status === 404) {
    return {
      kind: "wrong-reference",
      message:
        `GET ${path} returned 404 — no such collection or session on this flow. A reference this ` +
        `check got wrong, not a visibility declaration that is missing: ${body.slice(0, 200)}`,
    };
  }
  return { kind: "other", message: `GET ${path} returned ${status}: ${body.slice(0, 300)}` };
}

/** The calibration state fixture, shaped as the real routes answer. */
interface KnownState {
  workstreamId: string;
  runId: string;
  requests: unknown;
  collections: Record<string, Array<{ items?: unknown[]; nextCursor?: string }>>;
}

/**
 * A `read` backed by a checked-in state fixture, one page per call.
 *
 * Pages are served in order and a request for a page the fixture does not have
 * throws, so a reader that stopped following the cursor under-reads and the
 * calibration catches it rather than the account merely looking small. The
 * `topicPrefix` is required on every collection read for the same reason: an
 * unscoped read is a real defect that returns plausible rows.
 */
function calibrationRead(state: KnownState): Read {
  const served = new Map<string, number>();
  return async (path: string): Promise<unknown> => {
    const [route, query = ""] = path.split("?");
    if (route === `/sessions/${state.workstreamId}/requests`) return state.requests;
    const match = /^\/sessions\/([^/]+)\/resources\/([^/]+)$/.exec(route);
    if (match === null || match[1] !== state.workstreamId) {
      throw new Error(`the calibration state has no route for ${path}`);
    }
    const name = match[2];
    const pages = state.collections[name];
    if (pages === undefined) {
      throw new Error(describeReadFailure(404, path, `Unknown resource "${name}"`).message);
    }
    const prefix = new URLSearchParams(query).get("topicPrefix");
    if (prefix !== `${name}/${state.runId}/`) {
      throw new Error(
        `the reader read "${name}" with topicPrefix ${JSON.stringify(prefix)}; the run's ` +
          `namespace is "${name}/${state.runId}/" — an unscoped read returns another run's rows`,
      );
    }
    const n = served.get(name) ?? 0;
    served.set(name, n + 1);
    const page = pages[n];
    if (page === undefined) {
      throw new Error(`the reader asked "${name}" for page ${n + 1}; the fixture holds ${pages.length}`);
    }
    return page;
  };
}

/** One assertion the grader must be able to reach, and how. */
interface GuardCase {
  name: string;
  /** Mutate a clone of the known account, or return a replacement. */
  mutate: (account: Account) => Account | void;
  id: string;
  /**
   * The exact branch this world must reach.
   *
   * Asserting the status alone is not enough, and that is measured rather than
   * cautious: deleting A4's missing-report condition let the ordering
   * comparison handle that case instead, `null` coerced in the comparison, and
   * the resulting failure satisfied a status-only assertion. The guard reported
   * itself proven while the branch it names had been removed.
   */
  because: string;
  want: FindingStatus;
}

/**
 * Every guard, broken on purpose and observed — **before any run is dispatched**.
 *
 * Why the broken world is handed in rather than provoked by a real run is in
 * `goal.md`; the short version is that a mutation inside a branch no run reaches
 * never executes, and that green is identical to a working guard's.
 *
 * **Each world isolates ONE half.** Where an assertion has two conditions that
 * could carry each other, both get a case in which the other is satisfied —
 * otherwise weakening one changes nothing and the pair reports itself proven.
 * And where an assertion compares two sides, the world must make them
 * DISAGREE: a case built from a coherent record exercises no comparison at all.
 *
 * Each case names the exact branch it must reach, not merely the verdict. A
 * guard satisfied by the wrong branch is indistinguishable from one that works.
 */
const GUARD_CASES: GuardCase[] = [
  {
    // Whole-segment matching narrows the collision but does not remove it: a
    // run that names a file relatively, or a sub-agent touching a path the
    // fixture never named, can leave two rows that both end in the same
    // segments. Picking one would assign the wrong record; this must be a
    // can't-tell instead.
    name: "A1 — an expected path could be either of two rows",
    mutate: (a) => {
      a.did.push({
        runId: a.runIds[0],
        topic: `${a.runIds[0]}/inv_a/work/other/alpha.txt`,
        path: "/work/other/alpha.txt",
        kind: "created",
        outcome: "applied",
        firstAt: 9,
        namedBy: 1,
      });
      a.streamMutations.push({
        path: "/work/other/alpha.txt",
        tool: "Write",
        at: 9,
        status: "completed",
        kind: "created",
        outcome: "applied",
      });
    },
    because: "a1-ambiguous",
    id: "A1",
    want: "fail",
  },
  {
    // The sharp one: a mutation whose record is genuinely MISSING, hiding
    // behind a different row that shares its tail. Accepting the match is A2
    // passing on exactly the loss it exists to catch.
    name: "A2 — a mutation could be either of two rows, so a lost record could hide",
    mutate: (a) => {
      a.streamMutations.push({
        path: "alpha.txt",
        tool: "Write",
        at: 9,
        status: "completed",
        kind: "created",
        outcome: "applied",
      });
      a.did.push({
        runId: a.runIds[0],
        topic: `${a.runIds[0]}/inv_a/work/other/alpha.txt`,
        path: "/work/other/alpha.txt",
        kind: "created",
        outcome: "applied",
        firstAt: 10,
        namedBy: 1,
      });
    },
    because: "a2-ambiguous-mutation",
    id: "A2",
    want: "fail",
  },
  {
    name: "A2 — a row is named by two different mutations",
    mutate: (a) => {
      a.did[0].namedBy = 2;
    },
    because: "a2-ambiguous-row",
    id: "A2",
    want: "fail",
  },
  {
    // A DISAGREEMENT, not merely a well-formed record: the row says the file
    // was created, the stream shows an Edit. A guard built from a coherent
    // world exercises none of this comparison. LAB-134 shipped this defect.
    name: "A2 — the record says created and the stream shows an edit",
    mutate: (a) => {
      // The row whose stream mutation is an Edit now claims the file was
      // created. One side changed, so the two genuinely disagree.
      const row = a.did.find((d) => d.kind === "edited");
      if (row !== undefined) row.kind = "created";
    },
    because: "a2-kind-disagrees",
    id: "A2",
    want: "fail",
  },
  {
    // The other shipped defect: the settled outcome reusing the call-time value
    // instead of the harness's confirmed result. The stream says the call
    // failed; the record says it applied.
    name: "A2 — the record says applied and the stream shows the call failed",
    mutate: (a) => {
      const row = a.did.find((d) => d.outcome === "failed");
      if (row !== undefined) row.outcome = "applied";
    },
    because: "a2-outcome-disagrees",
    id: "A2",
    want: "fail",
  },
  {
    name: "A1 — an expected path is absent and the run made no shell call",
    mutate: (a) => {
      a.did = a.did.filter((d) => !d.topic.endsWith("alpha.txt"));
      a.streamMutations = a.streamMutations.filter((m) => !m.path.endsWith("alpha.txt"));
      a.shell = { called: false, calls: 0, succeeded: 0 };
    },
    because: "a1-missing-no-shell",
    id: "A1",
    want: "fail",
  },
  {
    name: "A1 — an expected path is absent and the run DID call the shell",
    mutate: (a) => {
      a.did = a.did.filter((d) => !d.topic.endsWith("alpha.txt"));
      a.streamMutations = a.streamMutations.filter((m) => !m.path.endsWith("alpha.txt"));
    },
    because: "a1-missing-with-shell",
    id: "A1",
    want: "unmeasured",
  },
  {
    // Between the two worlds above: the run reached for the shell and was
    // REFUSED. A call that never ran cannot have made the change, so this must
    // stay a failure — measured on a real run, where the agent tried `Bash`,
    // was denied, and said so in its own words.
    name: "A1 — an expected path is absent and every shell call was refused",
    mutate: (a) => {
      a.did = a.did.filter((d) => !d.topic.endsWith("alpha.txt"));
      a.streamMutations = a.streamMutations.filter((m) => !m.path.endsWith("alpha.txt"));
      a.shell = { called: true, calls: 2, succeeded: 0 };
    },
    id: "A1",
    because: "a1-missing-shell-denied",
    want: "fail",
  },
  {
    name: "A1 — every expected path unmeasured, so the run proved nothing",
    mutate: (a) => {
      a.did = [];
      a.streamMutations = [];
    },
    because: "a1-all-unmeasured",
    id: "A1",
    want: "fail",
  },
  {
    name: "A1 — a write is still pending after the run finished",
    mutate: (a) => {
      a.did[0].outcome = "pending";
    },
    because: "a1-unsettled",
    id: "A1",
    want: "fail",
  },
  {
    name: "A1 — the outcome field was projected away entirely",
    mutate: (a) => {
      a.did[0].outcome = null;
    },
    because: "a1-no-outcome",
    id: "A1",
    want: "fail",
  },
  {
    name: "A1 — a row records no kind",
    mutate: (a) => {
      a.did[0].kind = null;
    },
    because: "a1-no-kind",
    id: "A1",
    want: "fail",
  },
  {
    name: "A2 — a stream mutation has no row and no gap accounts for it",
    mutate: (a) => {
      a.did = a.did.filter((d) => !d.topic.endsWith("gamma.txt"));
    },
    because: "a2-unaccounted",
    id: "A2",
    want: "fail",
  },
  {
    name: "A2 — a stream mutation has no row but a gap row carries its path",
    mutate: (a) => {
      a.did = a.did.filter((d) => !d.topic.endsWith("gamma.txt"));
      a.gaps.push({ runId: a.runIds[0], reason: "skipped", rawPath: "/work/repo/gamma.txt" });
    },
    because: "a2-ok",
    id: "A2",
    want: "pass",
  },
  {
    // The neighbouring world A2 must NOT accept: a gap row exists, but for a
    // different path. "Some gap was written" is not an account of THIS loss,
    // and an implementation that only counted gaps would pass here.
    name: "A2 — a gap row accounts for a different path than the one that went missing",
    mutate: (a) => {
      a.did = a.did.filter((d) => !d.topic.endsWith("gamma.txt"));
      a.gaps.push({ runId: a.runIds[0], reason: "skipped", rawPath: "/work/repo/somewhere-else.txt" });
    },
    because: "a2-unaccounted",
    id: "A2",
    want: "fail",
  },
  {
    // And the world where the gap names nothing at all. A null path cannot
    // account for a specific mutation, however many such rows there are.
    name: "A2 — the only gap row carries no path",
    mutate: (a) => {
      a.did = a.did.filter((d) => !d.topic.endsWith("gamma.txt"));
      a.gaps.push({ runId: a.runIds[0], reason: "skipped", rawPath: null });
    },
    because: "a2-unaccounted",
    id: "A2",
    want: "fail",
  },
  {
    name: "A2 — the record claims an operation the stream does not show",
    mutate: (a) => {
      a.did.push({
        runId: a.runIds[0],
        topic: `${a.runIds[0]}/inv_a/work/repo/zeta.txt`,
        path: null,
        kind: "created",
        outcome: "applied",
        firstAt: null,
        namedBy: 0,
      });
    },
    because: "a2-row-without-stream",
    id: "A2",
    want: "fail",
  },
  {
    name: "A2 — a mutation carried no path and nothing was written down",
    mutate: (a) => {
      a.counts.mutationsWithNoPath = 1;
      a.gaps = [];
      a.streamMutations = a.streamMutations.filter((m) => !m.path.endsWith("epsilon.txt"));
    },
    because: "a2-pathless-no-gap",
    id: "A2",
    want: "fail",
  },
  {
    name: "A3 — the stream is out of order",
    mutate: (a) => {
      a.order.runs[0].indices = [5, 1, 2];
    },
    because: "a3-out-of-order",
    id: "A3",
    want: "fail",
  },
  {
    name: "A3 — an item carries no readable itemIndex",
    mutate: (a) => {
      a.order.runs[0].unreadable = 2;
    },
    because: "a3-unreadable",
    id: "A3",
    want: "fail",
  },
  {
    name: "A3 — only one distinct position, so ordering is unverifiable",
    mutate: (a) => {
      a.order.runs[0].indices = [4, 4, 4];
    },
    because: "a3-too-few-positions",
    id: "A3",
    want: "fail",
  },
  {
    name: "A3 — no request carried a stream at all",
    mutate: (a) => {
      a.order.runs = [];
    },
    because: "a3-no-stream",
    id: "A3",
    want: "fail",
  },
  {
    // The world a first-activity comparison ACCEPTS: the run acted, reported,
    // and then acted again. The report covers none of the work that followed
    // it, and every other assertion is content — A1 and A2 see the settled
    // write, A3 stays ordered. Only the last-activity comparison rejects it.
    name: "A4 — the run wrote another file after its final report",
    mutate: (a) => {
      a.order.runs[0].firstMutationAt = 1;
      a.order.runs[0].lastMessageAt = 2;
      a.order.runs[0].lastMutationAt = 3;
    },
    because: "a4-activity-after-report",
    id: "A4",
    want: "fail",
  },
  {
    name: "A4 — every mutation follows the report",
    mutate: (a) => {
      a.order.runs[0].firstMutationAt = 9;
      a.order.runs[0].lastMutationAt = 9;
      a.order.runs[0].lastMessageAt = 2;
    },
    because: "a4-activity-after-report",
    id: "A4",
    want: "fail",
  },
  {
    name: "A4 — there is no mutation to place the report against",
    mutate: (a) => {
      a.order.runs[0].firstMutationAt = null;
      a.order.runs[0].lastMutationAt = null;
    },
    because: "a4-unevaluable",
    id: "A4",
    want: "fail",
  },
  {
    // The other half of A4's can't-tell branch, standing alone. Testing only
    // the activity half would leave this one able to be broken silently: the
    // two conditions sit in one `if`, and either can carry the other.
    name: "A4 — there is no report to place against the activity",
    mutate: (a) => {
      a.order.runs[0].lastMessageAt = null;
    },
    because: "a4-unevaluable",
    id: "A4",
    want: "fail",
  },
  {
    name: "A5 — the plan tools fired and nothing was recorded",
    mutate: (a) => {
      a.planned = { arm: "LOST", reason: "the plan tools fired 3 time(s) and no plan row was recorded", rows: [] };
    },
    because: "a5-lost",
    id: "A5",
    want: "fail",
  },
  {
    name: "A5 — a plan row exists with no wording",
    mutate: (a) => {
      a.planned = {
        arm: "ROWS",
        reason: "1 plan row(s)",
        rows: [{ runId: a.runIds[0], title: null, status: "completed", previousStatus: null }],
      };
    },
    because: "a5-untitled",
    id: "A5",
    want: "fail",
  },
  {
    // The isolating world for A5's other half: every row is worded, and not one
    // carries a status. Without this, the wording check alone would satisfy the
    // suite and the status check could be broken without anything noticing.
    //
    // This whole branch is unreachable from a real run on this driver — the plan
    // tools never fire, so the ROWS arm never executes — which is exactly why it
    // is fed directly here. A mutation that cannot execute is not a mutation
    // that was rejected, and the green looks identical.
    name: "A5 — plan rows are worded but none carries a status",
    mutate: (a) => {
      a.planned = {
        arm: "ROWS",
        reason: "2 plan row(s)",
        rows: [
          { runId: a.runIds[0], title: "write the ledger", status: null, previousStatus: null },
          { runId: a.runIds[0], title: "edit the notes", status: null, previousStatus: null },
        ],
      };
    },
    because: "a5-no-status",
    id: "A5",
    want: "fail",
  },
  {
    name: "A5 — plan rows carry a wording and a status",
    mutate: (a) => {
      a.planned = {
        arm: "ROWS",
        reason: "1 plan row(s)",
        rows: [{ runId: a.runIds[0], title: "write the ledger", status: "completed", previousStatus: "in_progress" }],
      };
    },
    because: "a5-ok",
    id: "A5",
    want: "pass",
  },
  {
    name: "A5 — the run never planned, which reports rather than fails",
    mutate: () => undefined,
    because: "a5-unmeasured",
    id: "A5",
    want: "unmeasured",
  },
  {
    // Emptied at the SET, not at the count beside it: A6 has to notice that the
    // rows A1 and A2 iterate are gone, not merely that a number says so.
    name: "A6 — the file record's rows are gone",
    mutate: (a) => {
      a.did = [];
    },
    because: "a6-empty:fileRows",
    id: "A6",
    want: "fail",
  },
  {
    // The count still says four while the array holds none. An A6 that read the
    // count would report "fine" about a set nothing else could see.
    name: "A6 — the count disagrees with the set it describes",
    mutate: (a) => {
      a.did = [];
      a.counts.fileRows = 4;
    },
    because: "a6-empty:fileRows",
    id: "A6",
    want: "fail",
  },
  {
    name: "A6 — the account is empty end to end",
    mutate: (a) => {
      for (const key of Object.keys(a.counts)) a.counts[key as keyof Account["counts"]] = 0;
      a.did = [];
      a.said = [];
    },
    because: "a6-empty:requests",
    id: "A6",
    want: "fail",
  },
  {
    name: "A7 — a collection page was left unfollowed",
    mutate: (a) => {
      a.reads[OBSERVED_FILE_OPS].truncated = true;
    },
    because: "a7-truncated",
    id: "A7",
    want: "fail",
  },
  {
    name: "A7 — a collection was never read at all",
    mutate: (a) => {
      delete a.reads[OBSERVED_PLAN];
    },
    because: "a7-never-read",
    id: "A7",
    want: "fail",
  },
];

await runGoal(async () => {
  const fixture = loadFixture<Fixture>(import.meta.url);
  const expectedNames = [...fixture.createPaths, fixture.editPath];
  const failures: string[] = [];
  const notes: string[] = [];

  // ══ Precondition 0 — the fixture can be matched unambiguously ═════════════
  // Trailing-segment matching is what lets the two surfaces' different
  // spellings of one path compare at all, and it cannot be ambiguous.
  const basenames = expectedNames.map((p) => basename(p));
  if (new Set(basenames).size !== basenames.length) {
    return {
      failures: [
        `the fixture names two paths sharing a basename (${basenames.join(", ")}) — ` +
          `trailing-segment matching cannot tell them apart, so this fixture is rejected at setup`,
      ],
      evidence: "",
    };
  }

  // ══ Precondition 1a — the deprivation guard can see an import ═════════════
  // Proved before it is trusted: a scanner blind to the thing it forbids would
  // report the reader clean no matter what the reader imported.
  const scannerCases: Array<[string, string, boolean]> = [
    ["a static import", 'import { readFileSync } from "node:fs";', true],
    ["a dynamic import", 'const p = await import("node:child_process");', true],
    ["a bare side-effect import", 'import "node:process";', true],
    ["a require", 'const g = require("simple-git");', true],
    ["a line comment", '// import { readFileSync } from "node:fs";', false],
    ["a block comment", '/* it must never import "node:fs" here */', false],
  ];
  for (const [what, source, shouldSee] of scannerCases) {
    if ((importsOf(source).length > 0) !== shouldSee) {
      failures.push(
        `the deprivation scanner ${shouldSee ? "cannot see" : "falsely reports"} ${what} — ` +
          `assertion 8 would ${shouldSee ? "pass over a reader that reaches the tree" : "be red for prose"}`,
      );
    }
  }
  // The half an import allowlist cannot see. Each of these reaches the
  // filesystem while naming no module, so a specifier-only scanner reports the
  // reader clean — this epic's failure class inside its own guard.
  const escapeCases: Array<[string, string, boolean]> = [
    ["a bare process reference", "const here = process.cwd();", true],
    ["a globalThis hop", "const p = globalThis.process;", true],
    ["a computed dynamic import", "const m = await import(specifier);", true],
    ["a template-literal import", "const m = await import(`node:${name}`);", true],
    ["an ordinary literal import", 'const m = await import("./paths.mts");', false],
    ["prose mentioning the process", "/* never touch the process here */", false],
  ];
  for (const [what, source, shouldSee] of escapeCases) {
    if ((escapesOf(source).length > 0) !== shouldSee) {
      failures.push(
        `the escape scanner ${shouldSee ? "cannot see" : "falsely reports"} ${what} — ` +
          `assertion 8 checks module specifiers, and this is not one`,
      );
    }
  }

  // ══ Assertion 8 — the deprived sources, read mechanically ═════════════════
  const a8Problems: string[] = [];
  const a8Seen: string[] = [];
  for (const { file, mayImport } of DEPRIVED_MODULES) {
    const source = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
    const imports = importsOf(source);
    a8Seen.push(`${file} imports ${imports.map((i) => `"${i}"`).join(", ") || "nothing"}`);
    for (const spec of imports.filter((i) => !mayImport.includes(i))) {
      a8Problems.push(`${file} imports "${spec}"`);
    }
    for (const escape of escapesOf(source)) {
      a8Problems.push(`${file} reaches \`${escape}\``);
    }
  }
  const a8: Finding =
    a8Problems.length > 0
      ? {
          id: "A8",
          status: "fail",
          because: "a8-forbidden-import",
          message:
            `${a8Problems.join("; ")} — the deprivation is a parameter shape, and an import or a ` +
            `bare global is a second way in`,
        }
      : { id: "A8", status: "pass", because: "a8-ok", message: a8Seen.join("; ") };

  // ══ Precondition 1b — calibration against a state whose account is known ══
  const state = JSON.parse(readFileSync(fixturePath(import.meta.url, "known-state.json"), "utf8")) as KnownState;
  const knownAccount = JSON.parse(
    readFileSync(fixturePath(import.meta.url, "known-account.json"), "utf8"),
  ) as Account;

  let derived: Account;
  try {
    derived = await readAccount(calibrationRead(state), state.workstreamId);
    deepStrictEqual(derived, knownAccount);
  } catch (err) {
    return {
      failures: [
        `CALIBRATION FAILED — the reader does not derive the known account from the known state, ` +
          `so nothing it says about a real run can be trusted. Aborting before spending a coding ` +
          `run: ${(err as Error).message}`,
      ],
      evidence: "",
    };
  }

  // The known case, graded: an account we know is correct must come back clean,
  // with the plan half reporting UNMEASURED rather than passing.
  const calibrationExpectation: Expectation = {
    paths: ["alpha.txt", "beta.txt", "gamma.txt"],
  };
  // Every precondition below reports into `failures` rather than returning, so
  // one of them failing cannot hide the others. An early return here would have
  // meant a lossy-calibration failure masking the whole guard table — the same
  // shape as the assertion halves that mask each other, one level up.
  const baseline = grade(knownAccount, calibrationExpectation, COLLECTIONS);
  const baselineFailures = failuresOf(baseline);
  if (baselineFailures.length > 0) {
    failures.push(
      `CALIBRATION FAILED — the grader reports ${baselineFailures.length} failure(s) on a state ` +
        `whose account is correct, so a real FAIL would say nothing: ${baselineFailures.join(" | ")}`,
    );
  }

  // ══ Precondition 1c — a lossy state must be caught, not merely differ ═════
  const lossy = structuredClone(state);
  lossy.collections[OBSERVED_FILE_OPS][1].items?.splice(0, 1);
  const lossyAccount = await readAccount(calibrationRead(lossy), lossy.workstreamId);
  const lossyFindings = grade(lossyAccount, calibrationExpectation, COLLECTIONS);
  if (!lossyFindings.some((f) => f.id === "A2" && f.status === "fail")) {
    failures.push(
      `CALIBRATION FAILED — a state with one file-op row deliberately removed produced no A2 ` +
        `failure. The reader derived ${lossyAccount.counts.fileRows} row(s) against the known ` +
        `${knownAccount.counts.fileRows}, and the graph losing a mutation is the one thing this ` +
        `check exists to catch`,
    );
  }

  // ══ Precondition 1d — every guard broken on purpose, and observed ═════════
  for (const guard of GUARD_CASES) {
    const clone = structuredClone(knownAccount);
    const mutated = guard.mutate(clone) ?? clone;
    const findings = grade(mutated, calibrationExpectation, COLLECTIONS);
    if (
      !findings.some(
        (f) => f.id === guard.id && f.status === guard.want && f.because === guard.because,
      )
    ) {
      failures.push(
        `GUARD NOT PROVEN — "${guard.name}" did not reach ${guard.id}/${guard.because} with a ` +
          `${guard.want}; it produced ` +
          `${JSON.stringify(findings.filter((f) => f.id === guard.id).map((f) => `${f.because}=${f.status}`))}. ` +
          `An assertion nobody has watched fail is not a check — and one that failed by a ` +
          `different branch than the world names has not been watched either`,
      );
    }
  }

  // ══ Precondition 1e — a 403 and a 404 do not read alike ═══════════════════
  // Asserted on the KIND, not on words in the message. Both abort, so neither
  // is graded — but a reader handed the wrong diagnosis chases the wrong thing.
  for (const [status, want] of [
    [403, "permission"],
    [404, "wrong-reference"],
    [500, "other"],
  ] as const) {
    const actual = describeReadFailure(status, "/x", "").kind;
    if (actual !== want) {
      failures.push(`a ${status} is classified as "${actual}", not "${want}"`);
    }
  }

  if (failures.length > 0) {
    return {
      failures: [
        ...failures,
        "the preconditions did not hold, so no coding run was dispatched and nothing was graded",
      ],
      evidence: "",
    };
  }

  console.log(
    `CALIBRATED — the reader derived the known account exactly from a ${knownAccount.counts.items}-item ` +
      `state across ${knownAccount.reads[OBSERVED_FILE_OPS].pages} file-op page(s); a lossy copy was ` +
      `caught by A2; ${GUARD_CASES.length} guard(s) broken on purpose and each observed; ` +
      `${a8.status.toUpperCase()} on A8 (${a8.message}).`,
  );

  // ══ The real run ══════════════════════════════════════════════════════════
  const workDir = mkdtempSync(join(tmpdir(), "state-readback-"));
  const dbFile = join(workDir, "goal.sqlite");
  const targets = expectedNames.map((name) => join(workDir, name));
  // The file the run is asked to EDIT has to exist first. Seeding it is the run
  // harness legitimately using the filesystem; the reader still cannot.
  writeFileSync(join(workDir, fixture.editPath), fixture.seedContent, "utf8");

  const { createFlowState } = await import("@flow-state-dev/engine");
  const { sqliteStores } = await import("@flow-state-dev/store-sqlite");
  const { serve } = await import("@flow-state-dev/node");

  // SQLite, named deliberately: the in-memory store ignores `withItems` and
  // returns items whether or not the flag is set, so a readback that passed
  // there would prove nothing about the route the reader is reading.
  const stores = sqliteStores({ filename: dbFile });

  const codingTasks = defineTaskCollection({ id: BOARD_ID, scope: "user" });

  /** The board hands a worker a `TaskWorkerInput`; the agent block wants a prompt. */
  const taskGoalToPrompt = handler({
    name: "task-goal-to-prompt",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ prompt: z.string() }),
    execute: (input) => ({
      prompt: input.context === undefined ? input.goal : `${input.goal}\n\n${input.context}`,
    }),
  });

  const codingRun = sequencer({
    name: "coding-run",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.unknown(),
  })
    .step(taskGoalToPrompt)
    .step(
      claudeCodeAgent({
        sessionState: false,
        recordWork: true,
        // The plan tools are named so that a run which does not plan is the
        // HARNESS declining, not our configuration forbidding — otherwise A5's
        // UNMEASURED arm would fire on our own settings while reporting on the
        // driver. `Bash` is deliberately absent, and the run may still use it:
        // this is a permission allowlist, not an availability filter, which is
        // exactly why A1 splits a missing path two ways.
        allowedTools: ["Write", "Edit", "Read", "TaskCreate", "TaskUpdate"],
        // `acceptEdits`, not `bypassPermissions`: the latter is refused outright
        // when the process has root privileges, and the refusal arrives as a
        // bare exit code that reads like a broken dispatch.
        permissionMode: "acceptEdits",
        maxTurns: 24,
        systemPrompt:
          "You are a coding agent doing one small file-writing job. Keep a to-do list as you " +
          "work. Do the job, then say what you did in one sentence.",
      }),
    ) as unknown as TaskWorker;

  const board = taskBoard({
    name: BOARD_ID,
    boardId: BOARD_ID,
    collection: codingTasks,
    workers: { [ASSIGNEE]: { worker: codingRun, dispatch: { mode: "detached" } } },
  });

  const fileCodingTask = handler({
    name: "file-coding-task",
    inputSchema: z.object({ goal: z.string() }),
    uses: [board.capability],
    execute: async (input, ctx) => {
      await ctx.cap[BOARD_ID].addTask({
        goal: input.goal,
        assignee: ASSIGNEE,
        metadata: { topic: fixture.topic },
      });
    },
  });

  const codingFlow = defineFlow({
    kind: FLOW_KIND,
    actions: {
      dispatch: {
        block: sequencer({
          name: "harness-coding-dispatch",
          inputSchema: z.object({ goal: z.string() }),
          outputSchema: z.unknown(),
        })
          .tap(fileCodingTask)
          .step(board.drain),
      },
    },
  })({ id: "default" });

  function neverResolvesAModel(): never {
    throw new Error(
      "state-readback goal: this flow declares no generator actions — the coding run goes " +
        "through the Claude Code Agent SDK, which resolves its own model.",
    );
  }

  const flowstate = createFlowState({
    flows: { [FLOW_KIND]: codingFlow },
    modelResolver: Object.assign(neverResolvesAModel, {
      resolveId: neverResolvesAModel,
    }) as never,
    stores: { prod: { primary: stores } },
    defaultProfile: "prod",
    // The default is 30 s, tuned to a serverless shutdown grace period rather
    // than to a coding run. An in-process host must raise it past its longest
    // expected run or accept that any shutdown kills one.
    detachedDrainTimeoutMs: RUN_TIMEOUT_MS,
    logger: silentLogger,
  } as never);

  const host = await serve(flowstate as never, { port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${host.port}/api/flows`;

  /**
   * The reader's whole world, bound to this host.
   *
   * Throws on anything that is not a real answer. A swallowed transport error
   * would reach the reader as an empty page and be graded as a lossy graph —
   * a plausible-looking FAIL about entirely the wrong thing.
   */
  const read: Read = async (path: string): Promise<unknown> => {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`);
    } catch (err) {
      throw new Error(`GET ${path} could not reach the host: ${(err as Error).message}`);
    }
    if (!res.ok) throw new Error(describeReadFailure(res.status, path, await res.text()).message);
    try {
      return await res.json();
    } catch (err) {
      throw new Error(`GET ${path} returned an unparseable body: ${(err as Error).message}`);
    }
  };

  const job =
    `Create the file at the absolute path ${targets[0]} containing one line of text. ` +
    `Create the file at the absolute path ${targets[1]} containing one line of text. ` +
    `Then edit the existing file at the absolute path ${join(workDir, fixture.editPath)} to add ` +
    `a second line. Keep a to-do list of exactly ${fixture.planItemCount} items while you work, ` +
    `and mark each one in progress and then completed. ` +
    `Then reply in one sentence naming the files you touched.`;

  try {
    const dispatchRes = await fetch(`${base}/${FLOW_KIND}/actions/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { goal: job }, userId: USER_ID, sessionId: PARENT_SESSION_ID }),
    });
    if (dispatchRes.status >= 400) {
      return {
        failures: [
          `the dispatch failed with ${dispatchRes.status}: ${await dispatchRes.text()} — ` +
            `assertions over a run that never started are not evidence`,
        ],
        evidence: "",
      };
    }

    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let workstreams: WorkstreamRow[] = [];
    while (Date.now() < deadline) {
      const body = (await read(`/sessions/${PARENT_SESSION_ID}/workstreams`)) as {
        workstreams?: WorkstreamRow[];
      };
      workstreams = body?.workstreams ?? [];
      if (workstreams.length > 0 && workstreams.every((w) => w.status !== "active")) break;
      await sleep(POLL_INTERVAL_MS);
    }

    const workstream = workstreams[0];
    if (workstream === undefined) {
      return {
        failures: [
          `no workstream was started for ${PARENT_SESSION_ID} within ${RUN_TIMEOUT_MS}ms — the ` +
            `coding run never got its own place in the system, so there is no state to read`,
        ],
        evidence: "",
      };
    }
    if (workstream.status === "active") {
      return {
        failures: [
          `the workstream was still active after ${RUN_TIMEOUT_MS}ms — grading a half-finished ` +
            `run would produce a partial verdict, so this aborts instead`,
        ],
        evidence: "",
      };
    }

    // ══ Derive, then compare ════════════════════════════════════════════════
    // The reader has never seen `expectation`, and from here nothing else
    // touches the routes.
    const account = await readAccount(read, workstream.id);
    const expectation: Expectation = { paths: expectedNames };
    const findings: Finding[] = [...grade(account, expectation, COLLECTIONS), a8];

    // The account, printed whole — this IS the artifact, and a reader of the
    // log should be able to see what the state said without re-running.
    console.log(`\nACCOUNT — workstream ${workstream.id}, run(s) ${account.runIds.join(", ")}`);
    for (const entry of account.did) {
      console.log(
        `  did      ${entry.path ?? `(key ${entry.topic})`}  ${entry.kind ?? "(no kind)"}  ` +
          `${entry.outcome ?? "(no outcome)"}  first at ${entry.firstAt ?? "(never named)"}`,
      );
    }
    for (const gap of account.gaps) {
      console.log(`  gap      ${gap.reason ?? "(no reason)"}${gap.rawPath === null ? "" : `  path ${gap.rawPath}`}`);
    }
    for (const said of account.said) {
      console.log(`  said     [${said.at}] ${said.text.replace(/\s+/g, " ").slice(0, 160)}`);
    }
    console.log(`  planned  ${account.planned.arm} — ${account.planned.reason}`);
    console.log(
      `  shell    ${account.shell.calls} call(s), ${account.shell.succeeded} of them ran; ` +
        `tools seen: ${account.toolNamesSeen.join(", ") || "(none)"}`,
    );
    console.log(
      `  counts   ${Object.entries(account.counts).map(([k, v]) => `${k} ${v}`).join(" · ")}`,
    );
    console.log(
      `  pages    ${COLLECTIONS.map((c) => `${c} ${account.reads[c]?.pages ?? 0}`).join(" · ")}`,
    );
    console.log("\nVERDICTS");
    for (const finding of findings) {
      console.log(
        `  ${finding.id} ${finding.status.toUpperCase().padEnd(10)} [${finding.because}] ${finding.message}`,
      );
    }

    for (const finding of findings.filter((f) => f.status === "unmeasured")) {
      notes.push(`${finding.id} UNMEASURED — ${finding.message}`);
    }
    // Printed on every run, pass or fail: the verdict protocol prints evidence
    // only on a pass, and which arm the plan half took is exactly what the
    // verdict log has to carry. A drift toward never measuring anything must be
    // visible rather than comfortable.
    console.log(`\nPLAN ARM: ${account.planned.arm} — ${account.planned.reason}`);

    const graded = failuresOf(findings);
    return {
      failures: graded,
      evidence:
        `a real coding run was dispatched into workstream ${workstream.id} (status ` +
        `"${workstream.status}") and reconstructed from FSD state alone — the requests route with ` +
        `include_items=true, and the three session-scoped collections over the resource route, ` +
        `each scoped by topicPrefix to the run's own namespace and paged to exhaustion ` +
        `(${COLLECTIONS.map((c) => `${c}: ${account.reads[c].pages} page(s)/${account.reads[c].rows} row(s)`).join(", ")}). ` +
        `The account: ${account.counts.fileRows} file row(s), ${account.counts.gapRows} gap row(s), ` +
        `${account.counts.planRows} plan row(s), ${account.counts.messages} top-level message(s), ` +
        `${account.counts.toolOutputs} top-level tool_output(s), ${account.counts.streamMutations} ` +
        `stream mutation(s), ${account.shell.calls} shell call(s) of which ` +
        `${account.shell.succeeded} ran. ` +
        `${findings.filter((f) => f.status === "pass").length} assertion(s) passed` +
        (notes.length === 0 ? "" : `; ${notes.length} reported unmeasured: ${notes.join(" | ")}`) +
        `. Derived before comparing: the reader never saw the expectation ` +
        `(${expectation.paths.map((p) => basename(p)).join(", ")}), and imports only ` +
        `what ${DEPRIVED_MODULES.length} scanned module(s) may (${a8.message}). Calibrated ` +
        `first against a checked-in state whose ` +
        `account is known, with ${GUARD_CASES.length} guard(s) broken on purpose and observed. ` +
        `Store adapter: @flow-state-dev/store-sqlite. Settlement not asserted (FIX-1182); the ` +
        `run's prose, the files' contents and the working tree were never read.`,
    };
  } finally {
    await host.close();
    rmSync(workDir, { recursive: true, force: true });
  }
});
