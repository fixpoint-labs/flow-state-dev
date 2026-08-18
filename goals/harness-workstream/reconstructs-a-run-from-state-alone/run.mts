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
import { readAccount, type Account, type Read, type RunView } from "./reader.mts";
import {
  failuresOf,
  grade,
  gradeRun,
  type Expectation,
  type Finding,
  type FindingStatus,
} from "./grader.mts";

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
/** The grader, scanned for the per-run boundary (not for deprivation). */
const GRADER_SOURCE = fileURLToPath(new URL("./grader.mts", import.meta.url));

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
 * Raw comparisons between the two surfaces, made outside `compareField`.
 *
 * Every cross-surface field comparison has three outcomes — differ, stream
 * silent, record silent — and a hand-written `a !== b` only expresses the
 * first. The other two get decided by whichever `&& x !== null` guard the
 * author happened to write, which is how null-outcome got a failure and
 * null-kind got a skip: the same rule, half applied, one round apart.
 *
 * `compareField` takes both absence rules as required arguments, so silence
 * cannot be handled by omission. This scan is what keeps the next comparison
 * from being written beside it instead of through it — the type binds only the
 * calls that already go through the door.
 */
export function rawCrossSurfaceComparisons(source: string): string[] {
  const code = codeOf(source);
  const found: string[] = [];
  for (const match of code.matchAll(
    /\b(entry|mutation)\.(\w+)\s*[!=]==\s*(entry|mutation)\.(\w+)/g,
  )) {
    const [whole, left, , right] = match;
    if (left !== right) found.push(whole.trim());
  }
  return found;
}

/**
 * Functions that take a single run's view AND something account-wide.
 *
 * The pooled-vs-per-run class was five separate defects with one sentence: a
 * pooled value consumed inside a per-run judgement, so one run's evidence
 * excused another run's absence. Each was fixed by scoping the read, and the
 * next review found another — a fix aimed at the right defect at the wrong
 * extent.
 *
 * The extent that actually closes it is REACHABILITY: a per-run function is
 * handed one view and the other runs are not in scope, so a pooled read is a
 * compile error rather than an oversight. TypeScript enforces that as written —
 * but an edit can dissolve it by adding a parameter, and the whole lesson of
 * this issue is that a guard which cannot reach the code it guards looks
 * exactly like one that passes. So the boundary is checked over the source.
 */
export function boundaryBreaches(source: string): string[] {
  const code = codeOf(source);
  const breaches: string[] = [];
  // Signatures, from `function name(` to the closing `)` of its parameter list.
  for (const match of code.matchAll(/function\s+(\w+)\s*\(([^)]*)\)/g)) {
    const [, name, params] = match;
    if (!/\bGradeableView\b/.test(params)) continue;
    if (/\bGradeableAccount\b|\bAccount\b/.test(params)) {
      breaches.push(`${name} takes a run view AND an account-wide value`);
    }
  }
  return breaches;
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
  /** The run this check grades. The fixture holds a second one so the reader's
   *  per-run partition is exercised; only this one is put to the grader. */
  runId: string;
  requests: unknown;
  /** collection -> runId -> pages, so a read is served for the run that asked. */
  collections: Record<string, Record<string, Array<{ items?: unknown[]; nextCursor?: string }>>>;
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
    const byRun = state.collections[name];
    if (byRun === undefined) {
      throw new Error(describeReadFailure(404, path, `Unknown resource "${name}"`).message);
    }
    const prefix = new URLSearchParams(query).get("topicPrefix");
    const scoped = /^([^/]+)\/([^/]+)\/$/.exec(prefix ?? "");
    if (scoped === null || scoped[1] !== name) {
      throw new Error(
        `the reader read "${name}" with topicPrefix ${JSON.stringify(prefix)} — an unscoped read ` +
          `returns another run's rows, so the fixture refuses to serve it`,
      );
    }
    const runId = scoped[2];
    const pages = byRun[runId];
    if (pages === undefined) {
      throw new Error(`the fixture has no "${name}" pages for run "${runId}"`);
    }
    const key = `${name}/${runId}`;
    const n = served.get(key) ?? 0;
    served.set(key, n + 1);
    const page = pages[n];
    if (page === undefined) {
      throw new Error(`the reader asked "${key}" for page ${n + 1}; the fixture holds ${pages.length}`);
    }
    return page;
  };
}

/** One assertion the grader must be able to reach, and how. */
interface GuardCase {
  name: string;
  /** Mutate a clone of the known run's view, or return a replacement. */
  mutate: (view: RunView) => RunView | void;
  id: string;
  /**
   * The exact branch this world must reach.
   *
   * Asserting the status alone is not enough, and that is measured rather than
   * cautious: deleting A4's missing-report condition let the ordering
   * comparison handle that case instead, `null` coerced in the comparison, and
   * the resulting failure satisfied a status-only assertion. The guard reported
   * itself proven while the branch it named had been removed.
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
 * **These feed `gradeRun`, which is the whole per-run surface.** A case can
 * therefore reach every per-run assertion. What it CANNOT reach is anything the
 * reader derives — that is covered by the two-run calibration fixture instead,
 * and the distinction is not academic: a regression to the pooled plan arm once
 * ran green here precisely because the judgement was still reader-side.
 *
 * **Each world isolates ONE half.** Where an assertion has two conditions that
 * could carry each other, both get a case in which the other is satisfied. And
 * where an assertion compares two sides, the world must make them DISAGREE: a
 * case built from a coherent record exercises no comparison at all.
 */
const GUARD_CASES: GuardCase[] = [
  // ── A1 ──────────────────────────────────────────────────────────────────
  {
    // Whole-segment matching narrows the collision but does not remove it: a
    // run naming a file relatively, or a sub-agent touching a path the fixture
    // never named, can leave two rows ending in the same segments.
    name: "A1 — an expected path could be either of two rows",
    mutate: (v) => {
      v.did.push({
        topic: `${v.runId}/inv_a/work/other/alpha.txt`,
        path: "/work/other/alpha.txt",
        kind: "created",
        outcome: "applied",
        firstAt: 9,
        namedBy: 1,
      });
      v.streamMutations.push({
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
    name: "A1 — an expected path is absent and the run made no shell call",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("alpha.txt"));
      v.streamMutations = v.streamMutations.filter((m) => !m.path.endsWith("alpha.txt"));
      v.shell = { called: false, calls: 0, succeeded: 0 };
    },
    because: "a1-missing-no-shell",
    id: "A1",
    want: "fail",
  },
  {
    // Between the two: the run reached for the shell and was REFUSED. A call
    // that never ran cannot have made the change — measured on a real run.
    name: "A1 — an expected path is absent and every shell call was refused",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("alpha.txt"));
      v.streamMutations = v.streamMutations.filter((m) => !m.path.endsWith("alpha.txt"));
      v.shell = { called: true, calls: 2, succeeded: 0 };
    },
    because: "a1-missing-shell-denied",
    id: "A1",
    want: "fail",
  },
  {
    name: "A1 — an expected path is absent and the run DID run a shell command",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("alpha.txt"));
      v.streamMutations = v.streamMutations.filter((m) => !m.path.endsWith("alpha.txt"));
    },
    because: "a1-missing-with-shell",
    id: "A1",
    want: "unmeasured",
  },
  {
    name: "A1 — every expected path unmeasured, so the run proved nothing",
    mutate: (v) => {
      v.did = [];
      v.streamMutations = [];
    },
    because: "a1-all-unmeasured",
    id: "A1",
    want: "fail",
  },
  {
    name: "A1 — a write is still pending after the run finished",
    mutate: (v) => {
      v.did[0].outcome = "pending";
    },
    because: "a1-unsettled",
    id: "A1",
    want: "fail",
  },
  {
    name: "A1 — the outcome field was projected away entirely",
    mutate: (v) => {
      v.did[0].outcome = null;
    },
    because: "a1-no-outcome",
    id: "A1",
    want: "fail",
  },
  {
    name: "A1 — a row records no kind",
    mutate: (v) => {
      v.did[0].kind = null;
    },
    because: "a1-no-kind",
    id: "A1",
    want: "fail",
  },

  // ── A2 ──────────────────────────────────────────────────────────────────
  {
    name: "A2 — neither surface shows a mutation",
    mutate: (v) => {
      v.did = [];
      v.streamMutations = [];
      v.shell = { called: false, calls: 0, succeeded: 0 };
    },
    because: "a2-both-empty",
    id: "A2",
    want: "fail",
  },
  {
    name: "A2 — a stream mutation has no row and no gap accounts for it",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("gamma.txt"));
    },
    because: "a2-unaccounted",
    id: "A2",
    want: "fail",
  },
  {
    name: "A2 — a stream mutation has no row but a gap row carries its path",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("gamma.txt"));
      v.gaps.push({ kind: "file", reason: "skipped", rawPath: "/work/repo/gamma.txt" });
    },
    because: "a2-ok",
    id: "A2",
    want: "pass",
  },
  {
    // The neighbouring world A2 must NOT accept: a gap exists, for a different
    // path. "Some gap was written" is not an account of THIS loss.
    name: "A2 — a gap row accounts for a different path than the one that went missing",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("gamma.txt"));
      v.gaps.push({ kind: "file", reason: "skipped", rawPath: "/work/repo/somewhere-else.txt" });
    },
    because: "a2-unaccounted",
    id: "A2",
    want: "fail",
  },
  {
    name: "A2 — the only gap row carries no path",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("gamma.txt"));
      v.gaps.push({ kind: "file", reason: "skipped", rawPath: null });
    },
    because: "a2-unaccounted",
    id: "A2",
    want: "fail",
  },
  {
    // A gap exists, for this exact path, in this run — and it says it covers a
    // PLAN skip. It is not evidence about a mutation. `kind` is a closed set on
    // the row, so this is a field comparison rather than a guess.
    name: "A2 — a plan gap is offered for a lost file mutation",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("gamma.txt"));
      v.gaps.push({ kind: "plan", reason: "skipped", rawPath: "/work/repo/gamma.txt" });
    },
    because: "a2-unaccounted",
    id: "A2",
    want: "fail",
  },
  {
    // And a gap that names no subject at all — an older row, or the field
    // projected away. Absence is not evidence, so the exemption does not apply.
    name: "A2 — a gap naming no subject is offered for a lost file mutation",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("gamma.txt"));
      v.gaps.push({ kind: null, reason: "skipped", rawPath: "/work/repo/gamma.txt" });
    },
    because: "a2-unaccounted",
    id: "A2",
    want: "fail",
  },
  {
    // The same rule on the pathless side: a plan skip does not stand in for a
    // file skip just because neither carries a path.
    name: "A2 — a plan gap is offered for a pathless file skip",
    mutate: (v) => {
      v.gaps = [{ kind: "plan", reason: "a plan update arrived naming no item", rawPath: null }];
      v.streamMutations = v.streamMutations.filter((m) => !m.path.endsWith("epsilon.txt"));
    },
    because: "a2-pathless-no-gap",
    id: "A2",
    want: "fail",
  },
  {
    // And the world it MUST accept, so the rule is not simply "always fail":
    // a pathless file skip with a pathless file gap beside it.
    name: "A2 — a pathless file skip answered by a pathless file gap",
    mutate: () => undefined,
    because: "a2-ok",
    id: "A2",
    want: "pass",
  },
  {
    // ONE gap, TWO mutations on the same path with no row. `.find()` hands the
    // same row to both and certifies a state that lost one of them.
    name: "A2 — one gap row is made to excuse two lost mutations",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("gamma.txt"));
      v.streamMutations.push({
        path: "/work/repo/gamma.txt",
        tool: "Write",
        at: 9,
        status: "completed",
        kind: "created",
        outcome: "applied",
      });
      v.gaps.push({ kind: "file", reason: "skipped", rawPath: "/work/repo/gamma.txt" });
    },
    because: "a2-unaccounted",
    id: "A2",
    want: "fail",
  },
  {
    name: "A2 — the record claims an operation the stream does not show",
    mutate: (v) => {
      v.did.push({
        topic: `${v.runId}/inv_a/work/repo/zeta.txt`,
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
    name: "A2 — a mutation could be either of two rows, so a lost record could hide",
    mutate: (v) => {
      v.streamMutations.push({
        path: "alpha.txt",
        tool: "Write",
        at: 9,
        status: "completed",
        kind: "created",
        outcome: "applied",
      });
      v.did.push({
        topic: `${v.runId}/inv_a/work/other/alpha.txt`,
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
    // Built from the ARRAYS, not by setting a count: a second mutation that
    // also names the first row.
    name: "A2 — a row is named by two different mutations",
    mutate: (v) => {
      v.streamMutations.push({
        path: "alpha.txt",
        tool: "Write",
        at: 9,
        status: "completed",
        kind: "created",
        outcome: "applied",
      });
    },
    because: "a2-ambiguous-row",
    id: "A2",
    want: "fail",
  },
  {
    // BOTH DIRECTIONS, first: a Write that OVERWROTE an existing file is an
    // edit, and the recorder knows it because the harness reports the type.
    // Asserting `Write` means `created` failed this faithful state AND passed a
    // recorder that mislabelled the overwrite — red on truth, green on the
    // defect, with each symptom disguising the other.
    name: "A2 — a Write recorded as an edit is faithful",
    mutate: (v) => {
      const row = v.did.find((d) => d.path?.endsWith("alpha.txt") === true && d.kind === "created");
      if (row !== undefined) row.kind = "edited";
    },
    because: "a2-ok",
    id: "A2",
    want: "pass",
  },
  {
    // Second direction: a Write that CREATED is equally faithful. Both
    // labellings pass because the stream carries no evidence to tell them
    // apart — the teeth live on `Edit`, which is unambiguous, and the case
    // below proves they are still there.
    name: "A2 — a Write recorded as a creation is faithful",
    mutate: () => undefined,
    because: "a2-ok",
    id: "A2",
    want: "pass",
  },
  {
    // The half of the rule that was left un-applied: null OUTCOME failed from
    // round 5, null KIND kept skipping. Both now go through `compareField`,
    // which cannot be called without saying what each silence means.
    name: "A2 — a paired row cannot say how its file was touched",
    mutate: (v) => {
      const row = v.did.find((d) => d.path?.endsWith("delta.txt") === true);
      if (row !== undefined) row.kind = null;
    },
    because: "a2-row-kind-missing",
    id: "A2",
    want: "fail",
  },
  {
    // A message the account cannot report. Presence only — the anti-game
    // forbids reading the prose, and this never does.
    name: "A6 — a message carries no readable text",
    mutate: (v) => {
      v.messagesWithoutText = 1;
    },
    because: "a6-message-without-text",
    id: "A6",
    want: "fail",
  },
  {
    // A plan gap is the recorder saying what it could not record. Calls it
    // accounts for are a named absence, not a loss — the file side already had
    // this rule and the plan side did not.
    name: "A5 — every plan call is accounted for by a plan gap",
    mutate: (v) => {
      v.plan = { rows: [], toolCalls: 2 };
      v.gaps = [
        { kind: "plan", reason: "a plan item id could not be read", rawPath: null },
        { kind: "plan", reason: "a plan item id could not be read", rawPath: null },
      ];
    },
    because: "a5-unmeasured",
    id: "A5",
    want: "unmeasured",
  },
  {
    // And the shortfall, so the rule is not "any plan gap excuses everything".
    name: "A5 — fewer plan gaps than plan calls is still a loss",
    mutate: (v) => {
      v.plan = { rows: [], toolCalls: 2 };
      v.gaps = [{ kind: "plan", reason: "a plan item id could not be read", rawPath: null }];
    },
    because: "a5-lost",
    id: "A5",
    want: "fail",
  },
  {
    // A FILE gap does not excuse a plan call, the mirror of the rule that a
    // plan gap does not excuse a lost mutation.
    name: "A5 — a file gap is offered for a missing plan row",
    mutate: (v) => {
      v.plan = { rows: [], toolCalls: 1 };
      v.gaps = [{ kind: "file", reason: "could not be keyed", rawPath: "/work/repo/x.txt" }];
    },
    because: "a5-lost",
    id: "A5",
    want: "fail",
  },
  {
    // A row that exists and cannot say how its mutation ended. A1 only checks
    // the held-out paths, so an incidentally-touched file would otherwise pair
    // with an outcome-less row and A2 would still emit ok.
    name: "A2 — a paired row cannot say how its mutation ended",
    mutate: (v) => {
      const row = v.did.find((d) => d.path?.endsWith("delta.txt") === true);
      if (row !== undefined) row.outcome = null;
    },
    because: "a2-row-outcome-missing",
    id: "A2",
    want: "fail",
  },
  {
    // A DISAGREEMENT, not merely a well-formed record. LAB-134 shipped this.
    name: "A2 — the record says created and the stream shows an edit",
    mutate: (v) => {
      const row = v.did.find((d) => d.kind === "edited");
      if (row !== undefined) row.kind = "created";
    },
    because: "a2-kind-disagrees",
    id: "A2",
    want: "fail",
  },
  {
    name: "A2 — the record says applied and the stream shows the call failed",
    mutate: (v) => {
      const row = v.did.find((d) => d.outcome === "failed");
      if (row !== undefined) row.outcome = "applied";
    },
    because: "a2-outcome-disagrees",
    id: "A2",
    want: "fail",
  },
  {
    // The blind-check shape, inside the check built to detect it: the stream's
    // terminal status is unreadable, so it says nothing about how the mutation
    // ended — and the row's `applied` stands on no corroboration. Skipping the
    // comparison certifies; this must fail.
    name: "A2 — the stream cannot say how a mutation ended and the row claims applied",
    mutate: (v) => {
      v.streamMutations[0].status = "in_progress";
      v.streamMutations[0].outcome = null;
    },
    because: "a2-outcome-unevaluable",
    id: "A2",
    want: "fail",
  },
  {
    // A gap beside a settlement can disguise the settlement being wrong: the
    // gap explains the discrepancy, so an exemption checked before the
    // comparison accepts a row asserting a mutation nobody confirmed.
    name: "A2 — a gap row is present AND the file row contradicts the stream",
    mutate: (v) => {
      const row = v.did.find((d) => d.kind === "edited");
      if (row !== undefined) {
        row.kind = "created";
        v.gaps.push({ kind: "file", reason: "skipped", rawPath: row.path });
      }
    },
    because: "a2-kind-disagrees",
    id: "A2",
    want: "fail",
  },
  {
    name: "A2 — a mutation carried no path and nothing was written down",
    mutate: (v) => {
      v.gaps = [];
      v.streamMutations = v.streamMutations.filter((m) => !m.path.endsWith("epsilon.txt"));
    },
    because: "a2-pathless-no-gap",
    id: "A2",
    want: "fail",
  },
  {
    // A named-path gap is not evidence for a PATHLESS skip: different evidence
    // class, and the two pools are disjoint on purpose.
    name: "A2 — a named-path gap is offered for a pathless skip",
    mutate: (v) => {
      // The fixture already carries a pathless skip AND its pathless gap, so
      // the world is built by REMOVING that evidence and leaving only the
      // named-path gap. Bumping the count alone would be a no-op — the same way
      // this case stopped expressing its condition when the fixture gained the
      // skip, and said so rather than passing.
      v.gaps = v.gaps.filter((g) => g.rawPath !== null);
    },
    because: "a2-pathless-no-gap",
    id: "A2",
    want: "fail",
  },

  // ── A3 ──────────────────────────────────────────────────────────────────
  {
    name: "A3 — the stream is out of order",
    mutate: (v) => {
      v.order.indices = [5, 1, 2];
    },
    because: "a3-out-of-order",
    id: "A3",
    want: "fail",
  },
  {
    name: "A3 — an item carries no readable itemIndex",
    mutate: (v) => {
      v.order.unreadable = 2;
    },
    because: "a3-unreadable",
    id: "A3",
    want: "fail",
  },
  {
    name: "A3 — only one distinct position, so ordering is unverifiable",
    mutate: (v) => {
      v.order.indices = [4, 4, 4];
    },
    because: "a3-too-few-positions",
    id: "A3",
    want: "fail",
  },
  {
    name: "A3 — the stream carried no readable position at all",
    mutate: (v) => {
      v.order.indices = [];
    },
    because: "a3-too-few-positions",
    id: "A3",
    want: "fail",
  },

  // ── A4 ──────────────────────────────────────────────────────────────────
  {
    // The world a first-activity comparison ACCEPTS: acted, reported, acted
    // again. Every other assertion is content; only the last-mutation
    // comparison rejects it.
    name: "A4 — the run wrote another file after its final report",
    mutate: (v) => {
      v.order.firstMutationAt = 1;
      v.order.lastMessageAt = 2;
      v.order.lastMutationAt = 3;
    },
    because: "a4-activity-after-report",
    id: "A4",
    want: "fail",
  },
  {
    name: "A4 — every mutation follows the report",
    mutate: (v) => {
      v.order.firstMutationAt = 9;
      v.order.lastMutationAt = 9;
      v.order.lastMessageAt = 2;
    },
    because: "a4-activity-after-report",
    id: "A4",
    want: "fail",
  },
  {
    // The POC measured itemIndex carrying duplicates, so this is the ordinary
    // shape: nothing in the data says which came first.
    name: "A4 — the report and the last mutation share a stream position",
    mutate: (v) => {
      v.order.lastMutationAt = 6;
      v.order.lastMessageAt = 6;
    },
    because: "a4-tied",
    id: "A4",
    want: "fail",
  },
  {
    name: "A4 — there is no mutation to place the report against",
    mutate: (v) => {
      v.order.firstMutationAt = null;
      v.order.lastMutationAt = null;
    },
    because: "a4-unevaluable",
    id: "A4",
    want: "fail",
  },
  {
    // The other half of A4's can't-tell branch, standing alone.
    name: "A4 — there is no report to place against the mutations",
    mutate: (v) => {
      v.order.lastMessageAt = null;
    },
    because: "a4-unevaluable",
    id: "A4",
    want: "fail",
  },
  {
    // A sub-agent's mutation is not top-level, so A3's `unreadable` does not
    // cover it — and `lastMutationAt` computed from the readable subset would
    // assert an order over a smaller set than it describes.
    name: "A4 — a mutation carries no readable stream position",
    mutate: (v) => {
      v.order.unreadableMutationPositions = 1;
    },
    because: "a4-unreadable-mutation",
    id: "A4",
    want: "fail",
  },

  // ── A5 ──────────────────────────────────────────────────────────────────
  {
    name: "A5 — the plan tools fired and nothing was recorded",
    mutate: (v) => {
      v.plan = { rows: [], toolCalls: 3 };
    },
    because: "a5-lost",
    id: "A5",
    want: "fail",
  },
  {
    name: "A5 — a plan row exists with no wording",
    mutate: (v) => {
      v.plan = {
        rows: [{ title: null, status: "completed", previousStatus: null }],
        toolCalls: 2,
      };
    },
    because: "a5-untitled",
    id: "A5",
    want: "fail",
  },
  {
    // The isolating world for A5's other half: every row worded, not one with a
    // status. Unreachable from a real run on this driver, which is why it is
    // fed directly — a mutation that cannot execute is not one that was rejected.
    name: "A5 — plan rows are worded but none carries a status",
    mutate: (v) => {
      v.plan = {
        rows: [
          { title: "write the ledger", status: null, previousStatus: null },
          { title: "edit the notes", status: null, previousStatus: null },
        ],
        toolCalls: 2,
      };
    },
    because: "a5-no-status",
    id: "A5",
    want: "fail",
  },
  {
    name: "A5 — plan rows carry a wording and a status",
    mutate: (v) => {
      v.plan = {
        rows: [{ title: "write the ledger", status: "completed", previousStatus: "in_progress" }],
        toolCalls: 2,
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

  // ── A6 ──────────────────────────────────────────────────────────────────
  {
    // Emptied at the SET, not at a count beside it.
    name: "A6 — the file record's rows are gone",
    mutate: (v) => {
      v.did = [];
    },
    because: "a6-empty:fileRows",
    id: "A6",
    want: "fail",
  },
  {
    name: "A6 — the run said nothing",
    mutate: (v) => {
      v.said = [];
    },
    because: "a6-empty:messages",
    id: "A6",
    want: "fail",
  },
  {
    name: "A6 — the item stream is empty",
    mutate: (v) => {
      v.counts.items = 0;
    },
    because: "a6-empty:items",
    id: "A6",
    want: "fail",
  },

  // ── A7 ──────────────────────────────────────────────────────────────────
  {
    name: "A7 — a collection page was left unfollowed",
    mutate: (v) => {
      v.reads[OBSERVED_FILE_OPS].truncated = true;
    },
    because: "a7-truncated",
    id: "A7",
    want: "fail",
  },
  {
    name: "A7 — a collection was never read at all",
    mutate: (v) => {
      delete v.reads[OBSERVED_PLAN];
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
  const CALIBRATION_RUN_ID = state.runId;
  const gradedKnownRun = knownAccount.runs.find((r) => r.runId === CALIBRATION_RUN_ID);
  if (gradedKnownRun === undefined) {
    return {
      failures: [
        `CALIBRATION FAILED — the known account holds no view for "${CALIBRATION_RUN_ID}", so ` +
          `there is nothing to calibrate the grader against`,
      ],
      evidence: "",
    };
  }
  const knownRuns = [gradedKnownRun];
  // Every precondition below reports into `failures` rather than returning, so
  // one of them failing cannot hide the others. An early return here would have
  // meant a lossy-calibration failure masking the whole guard table — the same
  // shape as the assertion halves that mask each other, one level up.
  const baseline = grade(knownAccount, calibrationExpectation, COLLECTIONS, CALIBRATION_RUN_ID);
  const baselineFailures = failuresOf(baseline);
  if (baselineFailures.length > 0) {
    failures.push(
      `CALIBRATION FAILED — the grader reports ${baselineFailures.length} failure(s) on a state ` +
        `whose account is correct, so a real FAIL would say nothing: ${baselineFailures.join(" | ")}`,
    );
  }

  // ══ Precondition 1c — a lossy state must be caught, not merely differ ═════
  const lossy = structuredClone(state);
  lossy.collections[OBSERVED_FILE_OPS][lossy.runId][1].items?.splice(0, 1);
  const lossyAccount = await readAccount(calibrationRead(lossy), lossy.workstreamId);
  const lossyFindings = grade(lossyAccount, calibrationExpectation, COLLECTIONS, CALIBRATION_RUN_ID);
  const lossyRows = lossyAccount.runs.find((r) => r.runId === CALIBRATION_RUN_ID)?.did.length ?? 0;
  if (!lossyFindings.some((f) => f.id === "A2" && f.status === "fail")) {
    failures.push(
      `CALIBRATION FAILED — a state with one file-op row deliberately removed produced no A2 ` +
        `failure. The reader derived ${lossyRows} row(s) against the known ` +
        `${knownRuns[0].did.length}, and the graph losing a mutation is the one thing this ` +
        `check exists to catch`,
    );
  }

  // ══ Precondition 1c-bis — the reader PARTITIONS by run ════════════════════
  // The calibration state holds two runs, so this is exercised model-free on
  // every invocation. It has to be: the guard cases feed `gradeRun` a single
  // view, so nothing they build can reach the reader's own per-run derivation —
  // and a regression to a pooled plan arm once ran green for exactly that
  // reason. A view leaking another run's rows is the whole pooled-value class
  // coming back in through the door the assertions can no longer open.
  if (knownAccount.runs.length !== 2) {
    failures.push(
      `CALIBRATION FAILED — the calibration state holds two runs and the reader derived ` +
        `${knownAccount.runs.length} view(s), so the per-run partition is not under test`,
    );
  } else {
    for (const view of knownAccount.runs) {
      const foreign = view.did.filter((d) => !d.topic.startsWith(`${view.runId}/`));
      if (foreign.length > 0) {
        failures.push(
          `CALIBRATION FAILED — run ${view.runId}'s view holds ${foreign.length} row(s) keyed to ` +
            `another run (${foreign.map((f) => f.topic).join(", ")}), so a per-run judgement can ` +
            `still reach a pooled value`,
        );
      }
    }
  }

  // ══ Precondition 1d — every guard broken on purpose, and observed ═════════
  for (const guard of GUARD_CASES) {
    const clone = structuredClone(knownRuns[0]);
    const mutated = guard.mutate(clone) ?? clone;
    const findings = gradeRun(mutated, calibrationExpectation, COLLECTIONS);
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

  // ══ Precondition 1d-ter — the account-level branches fire ═════════════════
  // `gradeRun` takes a view and so cannot reach these; they are fed to `grade`.
  const ACCOUNT_CASES: Array<{ name: string; mutate: (a: Account) => void; because: string }> = [
    {
      name: "A0 — the workstream has no request history",
      mutate: (a) => {
        a.counts.requests = 0;
        a.runs = [];
      },
      because: "a0-no-requests",
    },
    {
      name: "A0 — a request was dropped before it became a run",
      mutate: (a) => {
        a.runs = a.runs.slice(0, 1);
      },
      because: "a0-request-dropped",
    },
    {
      name: "A0 — the run this check dispatched is not in the state it read",
      mutate: (a) => {
        for (const run of a.runs) run.runId = `${run.runId}-elsewhere`;
      },
      because: "a0-run-missing",
    },
  ];
  for (const accountCase of ACCOUNT_CASES) {
    const clone = structuredClone(knownAccount);
    accountCase.mutate(clone);
    const findings = grade(clone, calibrationExpectation, COLLECTIONS, CALIBRATION_RUN_ID);
    if (!findings.some((f) => f.because === accountCase.because && f.status === "fail")) {
      failures.push(
        `GUARD NOT PROVEN — "${accountCase.name}" did not reach ${accountCase.because} with a ` +
          `fail; it produced ${JSON.stringify(findings.map((f) => `${f.because}=${f.status}`))}`,
      );
    }
  }

  // ══ Precondition 1d-bis — the per-run boundary still holds ════════════════
  // Proved before it is trusted, like the import scanner.
  const boundaryCases: Array<[string, string, boolean]> = [
    ["a per-run function handed the account too", "function gradeX(view: GradeableView, all: GradeableAccount) {}", true],
    ["a clean per-run function", "function gradeX(view: GradeableView, e: Expectation) {}", false],
    ["the account-level entry point", "function grade(account: GradeableAccount, e: Expectation) {}", false],
  ];
  for (const [what, source, shouldSee] of boundaryCases) {
    if ((boundaryBreaches(source).length > 0) !== shouldSee) {
      failures.push(
        `the per-run boundary scanner ${shouldSee ? "cannot see" : "falsely reports"} ${what}`,
      );
    }
  }
  const comparisonCases: Array<[string, string, boolean]> = [
    ["a hand-written cross-surface comparison", "if (entry.kind !== mutation.kind) {}", true],
    ["one written the other way round", "if (mutation.outcome === entry.outcome) {}", true],
    ["a same-surface comparison", "if (entry.kind !== entry.outcome) {}", false],
    ["a comparison routed through the combinator", "compareField({ stream: m.kind, record: e.kind })", false],
  ];
  for (const [what, source, shouldSee] of comparisonCases) {
    if ((rawCrossSurfaceComparisons(source).length > 0) !== shouldSee) {
      failures.push(`the cross-surface scanner ${shouldSee ? "cannot see" : "falsely reports"} ${what}`);
    }
  }
  const rawComparisons = rawCrossSurfaceComparisons(readFileSync(GRADER_SOURCE, "utf8"));
  if (rawComparisons.length > 0) {
    failures.push(
      `A FIELD IS COMPARED OUTSIDE compareField — ${rawComparisons.join("; ")}. A hand-written ` +
        `cross-surface comparison expresses only the disagree case, and the two silences get ` +
        `decided by omission. That is how the same rule came to be half applied`,
    );
  }

  const breaches = boundaryBreaches(readFileSync(GRADER_SOURCE, "utf8"));
  if (breaches.length > 0) {
    failures.push(
      `THE PER-RUN BOUNDARY IS OPEN — ${breaches.join("; ")}. A per-run judgement that can see ` +
        `across runs is how one run's evidence comes to excuse another run's absence, five times ` +
        `over; the fix is that the other runs are not in scope, not that each read is filtered`,
    );
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
    `CALIBRATED — the reader derived the known account exactly from a ` +
      `${knownAccount.counts.requests}-run state (${knownRuns[0].counts.items} items in the graded ` +
      `run, across ${knownRuns[0].reads[OBSERVED_FILE_OPS].pages} file-op page(s)), partitioned ` +
      `per run with no view holding another's rows; a lossy copy was caught by A2; ` +
      `${GUARD_CASES.length + ACCOUNT_CASES.length} guard(s) broken on purpose and each ` +
      `observed; ` +
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
    // This check grades ONE run, and names which. The expectation was given to
    // the run this goal dispatched; a workstream holding more than one request
    // has runs no expectation can be attributed to, and grading it anyway would
    // be a claim wider than the measurement.
    if (account.counts.requests !== 1) {
      return {
        failures: [
          `the workstream holds ${account.counts.requests} request(s) and this check grades one ` +
            `run — the held-out expectation belongs to the run it dispatched and cannot be ` +
            `attributed across several, so this aborts rather than picking one`,
        ],
        evidence: "",
      };
    }
    // THE DIAGNOSTIC MUST BE REACHABLE ON THE REAL PATH. A single request whose
    // id cannot be read is counted but yields no view, so the count check above
    // passes and `view.runId` would throw here — before `grade` could emit the
    // `a0-request-dropped` finding written for exactly this state. The guard
    // case calls `grade` directly and so never crossed this line: a guard that
    // cannot reach the code it guards looks identical to one that passes, which
    // is the defect this whole check exists to detect, one round old.
    const view = account.runs[0];
    const expectation: Expectation = { paths: expectedNames };
    const findings: Finding[] = [
      ...grade(account, expectation, COLLECTIONS, view?.runId ?? "(no readable run id)"),
      a8,
    ];
    if (view === undefined) {
      return {
        failures: failuresOf(findings),
        evidence: "",
      };
    }

    // The account, printed whole — this IS the artifact, and a reader of the
    // log should be able to see what the state said without re-running.
    console.log(`\nACCOUNT — workstream ${workstream.id}, run ${view.runId}`);
    for (const entry of view.did) {
      console.log(
        `  did      ${entry.path ?? `(key ${entry.topic})`}  ${entry.kind ?? "(no kind)"}  ` +
          `${entry.outcome ?? "(no outcome)"}  first at ${entry.firstAt ?? "(never named)"}`,
      );
    }
    for (const gap of view.gaps) {
      console.log(`  gap      ${gap.reason ?? "(no reason)"}${gap.rawPath === null ? "" : `  path ${gap.rawPath}`}`);
    }
    for (const said of view.said) {
      console.log(`  said     [${said.at}] ${said.text.replace(/\s+/g, " ").slice(0, 160)}`);
    }
    const planFinding = findings.find((f) => f.id === "A5");
    console.log(
      `  planned  ${planFinding?.because.replace("a5-", "").toUpperCase() ?? "?"} — ` +
        `${planFinding?.message ?? "(not graded)"}`,
    );
    console.log(
      `  shell    ${view.shell.calls} call(s), ${view.shell.succeeded} of them ran; ` +
        `tools seen: ${view.toolNamesSeen.join(", ") || "(none)"}`,
    );
    console.log(
      `  counts   ${Object.entries(view.counts).map(([k, n]) => `${k} ${n}`).join(" · ")} · ` +
        `fileRows ${view.did.length} · gapRows ${view.gaps.length} · planRows ${view.plan.rows.length} · ` +
        `streamMutations ${view.streamMutations.length} · pathless ${view.mutationsWithNoPath}`,
    );
    console.log(
      `  pages    ${COLLECTIONS.map((c) => `${c} ${view.reads[c]?.pages ?? 0}`).join(" · ")}`,
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
    console.log(`
PLAN ARM: ${planFinding?.status.toUpperCase()} — ${planFinding?.message}`);

    const graded = failuresOf(findings);
    return {
      failures: graded,
      evidence:
        `a real coding run was dispatched into workstream ${workstream.id} (status ` +
        `"${workstream.status}") and reconstructed from FSD state alone — the requests route with ` +
        `include_items=true, and the three session-scoped collections over the resource route, ` +
        `each scoped by topicPrefix to the run's own namespace and paged to exhaustion ` +
        `(${COLLECTIONS.map((c) => `${c}: ${view.reads[c].pages} page(s)/${view.reads[c].rows} row(s)`).join(", ")}). ` +
        `The account for run ${view.runId}: ${view.did.length} file row(s), ${view.gaps.length} gap ` +
        `row(s), ${view.plan.rows.length} plan row(s), ${view.said.length} top-level message(s), ` +
        `${view.counts.toolOutputs} top-level tool_output(s), ${view.streamMutations.length} ` +
        `stream mutation(s), ${view.shell.calls} shell call(s) of which ${view.shell.succeeded} ran. ` +
        `${findings.filter((f) => f.status === "pass").length} assertion(s) passed` +
        (notes.length === 0 ? "" : `; ${notes.length} reported unmeasured: ${notes.join(" | ")}`) +
        `. Derived before comparing: the reader never saw the expectation ` +
        `(${expectation.paths.map((p) => basename(p)).join(", ")}), and imports only ` +
        `what ${DEPRIVED_MODULES.length} scanned module(s) may (${a8.message}). Calibrated ` +
        `first against a checked-in state whose ` +
        `account is known, with ${GUARD_CASES.length + ACCOUNT_CASES.length} guard(s) broken on ` +
        `purpose and observed. ` +
        `Store adapter: @flow-state-dev/store-sqlite. Settlement not asserted (FIX-1182); the ` +
        `run's prose, the files' contents and the working tree were never read.`,
    };
  } finally {
    await host.close();
    rmSync(workDir, { recursive: true, force: true });
  }
});
