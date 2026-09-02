/**
 * Goal check — harness-child-session › it reconstructs a run from state alone.
 *
 * Dispatches a REAL coding run into a child session, then hands a reader nothing
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
 * Run: pnpm tsx goals/harness-child-session/reconstructs-a-run-from-state-alone/run.mts
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
/** Fresh per invocation, so the child session this reads holds only this run. */
const PARENT_SESSION_ID = `sess_state_readback_${Date.now()}`;

const RUN_TIMEOUT_MS = Number(process.env.GOAL_RUN_TIMEOUT_MS ?? 300_000);
const POLL_INTERVAL_MS = 2_000;

type ChildSessionRow = { id: string; parentSessionId?: string; topic?: string; status?: string };

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

/** The slice of a fixture item precondition 1c-ter reads. */
interface StoredCalItem {
  itemIndex?: number;
  ownedBy?: string;
}

/** The calibration state fixture, shaped as the real routes answer. */
interface KnownState {
  childSessionId: string;
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
    if (route === `/sessions/${state.childSessionId}/requests`) return state.requests;
    const match = /^\/sessions\/([^/]+)\/resources\/([^/]+)$/.exec(route);
    if (match === null || match[1] !== state.childSessionId) {
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
  /**
   * Grade this world against a different expectation.
   *
   * The calibration expectation is the default and most worlds want it. Ground
   * truth about the DIRECTORY — which paths existed before the run — is part of
   * the expectation rather than the account, so a world about it has to vary
   * the expectation instead of the view.
   */
  expectation?: Expectation;
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
    // THE FIFTH SELF-INFLICTED REGRESSION, and the one with three careful steps
    // behind it. The coordinator first said "a shell call makes that path
    // unmeasured"; that was corrected — on measurement, from a real run where
    // the harness refused `Bash` — to "a call that never ran cannot have made
    // the change", which became a FAILURE here. Right about refusal. Silent
    // about the other world: `emitToolResult` stores every errored result as
    // `failed`, so a `Bash` that ran, wrote this file and then exited nonzero
    // is the same item as a refused one. The first instinct was right about a
    // case the correction did not cover, and the correction was right about the
    // case it was shown.
    //
    // So the branch says UNKNOWABLE rather than choosing. It is counted as
    // unmeasured, which is what keeps `a1-all-unmeasured` able to fire.
    name: "A1 — an expected path is absent and no shell call completed",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("alpha.txt"));
      v.streamMutations = v.streamMutations.filter((m) => !m.path.endsWith("alpha.txt"));
      v.shell = { called: true, calls: 2, succeeded: 0 };
    },
    because: "a1-missing-shell-unknowable",
    id: "A1",
    want: "unmeasured",
  },
  {
    // The neighbour this must NOT sweep up, and the reason the fold is a
    // narrowing rather than a surrender: with NO shell call there is no second
    // world to be uncertain about, so a missing path is still the graph having
    // lost it. Without this case, "stop failing when the shell failed" would
    // look indistinguishable from "stop failing".
    name: "A1 — a missing path with no shell call is still lost, not unknowable",
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
    // And the hole the fold could have opened: every path landing in the new
    // branch must still reach the INCONCLUSIVE arm. A run that measured nothing
    // must not come back green with three polite notes — which is what would
    // happen if the unmeasured counter were not incremented there.
    name: "A1 — every path unknowable because no shell call completed",
    mutate: (v) => {
      v.did = [];
      v.streamMutations = [];
      v.shell = { called: true, calls: 1, succeeded: 0 };
    },
    because: "a1-all-unmeasured",
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
    // The ambiguity rule's THIRD direction, and the one that stayed open after
    // the other two were closed: one mutation, no row, and two gaps that could
    // each be the one covering it. The run names the file relatively — the
    // ordinary way a shorter spelling matches more than one candidate — so
    // consuming the first would excuse this loss with a row that may belong to
    // a different one. Two-or-more is unresolvable here exactly as it is when
    // the many-side is rows or mutations.
    name: "A2 — two gap rows could each be the one covering a lost mutation",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("gamma.txt"));
      for (const m of v.streamMutations) {
        if (m.path.endsWith("gamma.txt")) m.path = "gamma.txt";
      }
      v.gaps.push({ kind: "file", reason: "skipped", rawPath: "/work/repo/gamma.txt" });
      v.gaps.push({ kind: "file", reason: "skipped", rawPath: "/work/vendor/gamma.txt" });
    },
    because: "a2-ambiguous-gap",
    id: "A2",
    want: "fail",
  },
  {
    // THE FIFTH DIRECTION, AND THE FIRST ONE CAUSED BY REPAIRING THE FOURTH.
    // Two attempts at one unkeyable path leave two gaps carrying the SAME
    // `rawPath`. Every mutation matches both, so the round-7 branch called it
    // ambiguous — but there is nothing to get wrong: the two gaps are the same
    // claim twice, and two of them against two mutations is a valid one-to-one
    // accounting. The rule I was given rejected a faithful record because it
    // counted candidates instead of distinguishing them.
    //
    // This world must PASS, and the case above must keep failing. Both are
    // needed: without the second, "stop failing on two candidates" would look
    // like a fix.
    name: "A2 — two interchangeable gaps account for two attempts at one path",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("gamma.txt"));
      const gamma = v.streamMutations.find((m) => m.path.endsWith("gamma.txt"));
      if (gamma !== undefined) {
        v.streamMutations.push({ ...gamma, at: (gamma.at ?? 0) + 1 });
      }
      v.gaps.push({ kind: "file", reason: "skipped", rawPath: "/work/repo/gamma.txt" });
      v.gaps.push({ kind: "file", reason: "skipped", rawPath: "/work/repo/gamma.txt" });
    },
    because: "a2-ok",
    id: "A2",
    want: "pass",
  },
  {
    // And the shortfall on that same side, so consumption stays one-to-one
    // rather than becoming "any matching gap excuses any number of losses":
    // three attempts, two gaps, one loss nothing accounts for.
    name: "A2 — three attempts at one path and only two gaps beside them",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("gamma.txt"));
      const gamma = v.streamMutations.find((m) => m.path.endsWith("gamma.txt"));
      if (gamma !== undefined) {
        v.streamMutations.push({ ...gamma, at: (gamma.at ?? 0) + 1 });
        v.streamMutations.push({ ...gamma, at: (gamma.at ?? 0) + 2 });
      }
      v.gaps.push({ kind: "file", reason: "skipped", rawPath: "/work/repo/gamma.txt" });
      v.gaps.push({ kind: "file", reason: "skipped", rawPath: "/work/repo/gamma.txt" });
    },
    because: "a2-unaccounted",
    id: "A2",
    want: "fail",
  },
  {
    // THE SEVENTH DIRECTION, AND THE SECOND ONE CAUSED BY ONE OF OUR OWN
    // REPAIRS — from the same lineage as the fifth.
    //
    // Round 10 made the discriminator "distinct spellings", counted PER
    // MUTATION. That is locally true and globally wrong: one gap spelling can
    // be a candidate for several DIFFERENT mutation spellings, and whichever
    // mutation the loop reached first consumed one. Here two lost mutations —
    // `gamma.txt` and `sub/gamma.txt` — sit beside two gaps BOTH spelled
    // `/work/repo/sub/gamma.txt`. Each mutation saw exactly one spelling, each
    // consumed a row, and A2 reported `a2-ok`. But those two gaps evidence two
    // attempts on `sub/gamma.txt`, and the lost `gamma.txt` mutation has no gap
    // at all.
    //
    // Before the round-10 repair this world FAILED — correctly, and by
    // accident, because two candidates were called ambiguous. The repair turned
    // a correct-by-accident reject into a false green, which is why "does the
    // fix reintroduce the world the previous fix happened to cover?" is now
    // part of the question rather than a nicety.
    name: "A2 — one gap spelling offered to two differently-spelled lost mutations",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("gamma.txt"));
      const gamma = v.streamMutations.find((m) => m.path.endsWith("gamma.txt"));
      if (gamma !== undefined) {
        gamma.path = "gamma.txt";
        v.streamMutations.push({ ...gamma, path: "sub/gamma.txt", at: (gamma.at ?? 0) + 1 });
      }
      v.gaps.push({ kind: "file", reason: "skipped", rawPath: "/work/repo/sub/gamma.txt" });
      v.gaps.push({ kind: "file", reason: "skipped", rawPath: "/work/repo/sub/gamma.txt" });
    },
    because: "a2-ambiguous-gap",
    id: "A2",
    want: "fail",
  },
  {
    // And the direction that keeps the fix from being "two losses now fail":
    // two lost mutations with DIFFERENT spellings, each answered by a gap only
    // it can claim. Nothing here is unresolvable — every assignment is forced —
    // so this must PASS. Without it, closing the seventh would look exactly
    // like rejecting any run that lost more than one file.
    name: "A2 — two distinct losses, each answered by a gap only it can claim",
    mutate: (v) => {
      v.did = v.did.filter(
        (d) => !d.topic.endsWith("gamma.txt") && !d.topic.endsWith("delta.txt"),
      );
      v.gaps.push({ kind: "file", reason: "skipped", rawPath: "/work/repo/gamma.txt" });
      v.gaps.push({ kind: "file", reason: "skipped", rawPath: "/work/repo/delta.txt" });
    },
    because: "a2-ok",
    id: "A2",
    want: "pass",
  },
  {
    // THE FOURTH SELF-INFLICTED REGRESSION, and the one from the repair for
    // this file's worst defect.
    //
    // The tool table once asserted `Write` means `created`, which failed
    // faithful state AND passed a recorder mislabelling an overwrite. The
    // repair made `Write` indeterminate — right about the STREAM, which carries
    // no field telling creation from overwrite. But the harness makes a fresh
    // directory and seeds one file, so it knows which paths cannot exist, and
    // the repair discarded that too. A recorder labelling a creation `edited`
    // then passed A1 (kind is non-null) and passed A2 (the kind comparison is
    // skipped, correctly, because the stream says nothing).
    //
    // Ground truth is now graded where it lives — in the expectation, after the
    // account exists. `delta.txt` did not exist, one applied call touched it,
    // and the record calling that anything but a creation is wrong.
    name: "A1 — a creation the harness knows about, recorded as an edit",
    expectation: {
      paths: ["delta.txt"],
      existedBefore: { "delta.txt": false },
    },
    mutate: (v) => {
      const delta = v.did.find((d) => d.topic.endsWith("delta.txt"));
      if (delta !== undefined) delta.kind = "edited";
    },
    because: "a1-kind-not-created",
    id: "A1",
    want: "fail",
  },
  {
    // The other direction of the same ground truth, and the one the inverted
    // table used to get backwards: a path the harness SEEDED cannot have been
    // created by the run, whatever the stream says. This is the half that the
    // stream can never catch on its own — a `Write` over an existing file is
    // indeterminate there by construction.
    name: "A1 — a seeded file the record claims the run created",
    expectation: {
      paths: ["beta.txt"],
      existedBefore: { "beta.txt": true },
    },
    mutate: (v) => {
      const beta = v.did.find((d) => d.topic.endsWith("beta.txt"));
      if (beta !== undefined) beta.kind = "created";
    },
    because: "a1-kind-impossible",
    id: "A1",
    want: "fail",
  },
  {
    // THE MIRROR OF THE GROUND-TRUTH RULE, WHICH THE FIRST VERSION LEFT OPEN.
    //
    // A1 asked only "is this wrongly `edited`?" — and A2 abstains on `Write` by
    // design, because the stream cannot tell creation from overwrite. So a
    // fresh target with TWO applied writes and a row still saying `created`
    // passed both. The first applied call is what MADE THE PATH EXIST, so the
    // second wrote over a file that was already there; the row's last kind
    // cannot be a creation. This is the exact recorder regression the harness
    // ground truth was added to catch, certified by the check that added it.
    //
    // Reachable by a dispatched run, unlike the scan findings: the graded run
    // at `58006beb4` was the first real run to touch a path twice.
    name: "A1 — a fresh target written twice, still recorded as created",
    expectation: {
      paths: ["delta.txt"],
      existedBefore: { "delta.txt": false },
    },
    mutate: (v) => {
      const delta = v.streamMutations.find((m) => m.path.endsWith("delta.txt"));
      if (delta !== undefined) v.streamMutations.push({ ...delta, at: (delta.at ?? 0) + 1 });
    },
    because: "a1-kind-stale-created",
    id: "A1",
    want: "fail",
  },
  {
    // The faithful version of that world, so the fix does not become "a repeat
    // touch on a create target fails": the same two applied writes, with the
    // row correctly folded to `edited`.
    name: "A1 — a fresh target written twice and recorded as edited",
    expectation: {
      paths: ["delta.txt"],
      existedBefore: { "delta.txt": false },
    },
    mutate: (v) => {
      const delta = v.streamMutations.find((m) => m.path.endsWith("delta.txt"));
      if (delta !== undefined) v.streamMutations.push({ ...delta, at: (delta.at ?? 0) + 1 });
      const row = v.did.find((d) => d.topic.endsWith("delta.txt"));
      if (row !== undefined) row.kind = "edited";
    },
    because: "a1-ok",
    id: "A1",
    want: "pass",
  },
  {
    // And the single-call case the new rule must leave alone, which is what
    // keeps it from collapsing into "`created` is never allowed on a target the
    // run touched": one applied write on a fresh path reads `created`, and that
    // is the ordinary shape of every real run's two create targets.
    name: "A1 — a fresh target written once still reads as created",
    expectation: {
      paths: ["delta.txt"],
      existedBefore: { "delta.txt": false },
    },
    mutate: (v) => v,
    because: "a1-ok",
    id: "A1",
    want: "pass",
  },
  {
    // And the world it MUST accept, so the fix is not "any `edited` row on a
    // create target fails": a create target written and THEN edited. The row is
    // an aggregate carrying the last call, so `edited` is faithful — and the
    // created-check stands down because more than one mutation names the row.
    // `alpha.txt` is exactly that shape in the fixture.
    name: "A1 — a create target written and then edited reads as edited",
    expectation: {
      paths: ["alpha.txt"],
      existedBefore: { "alpha.txt": false },
    },
    mutate: (v) => v,
    because: "a1-ok",
    id: "A1",
    want: "pass",
  },
  {
    // And the other stand-down, for the other reason: one call, but it FAILED,
    // so nothing was created and `created` is not required. `gamma.txt` is a
    // failed `Write` in the fixture whose row says `created`/`failed`.
    name: "A1 — a create target whose only call failed is not held to created",
    expectation: {
      paths: ["gamma.txt"],
      existedBefore: { "gamma.txt": false },
    },
    mutate: (v) => v,
    because: "a1-ok",
    id: "A1",
    want: "pass",
  },
  {
    // The harness always knows whether a path existed, so a dispatched path
    // with no ground truth beside it is a dropped field rather than a path
    // about which nothing can be said. Decided explicitly, like every other
    // absence in this check.
    name: "A1 — a dispatched path carrying no ground truth",
    expectation: {
      paths: ["beta.txt"],
      existedBefore: {},
    },
    mutate: (v) => v,
    because: "a1-no-ground-truth",
    id: "A1",
    want: "fail",
  },
  {
    // THE THIRD SELF-INFLICTED REGRESSION. Terminal selection came from the
    // aggregate-row repair, and it rejected EVERY tie — including ties where
    // no choice exists to get wrong. Two `Edit` calls on one path that both
    // complete carry identical kind and outcome, so a faithful
    // `edited`/`applied` row agrees with either. The state left nothing unsaid;
    // the check invented a question.
    //
    // Same shape as the seventh gap direction: right about the world it was
    // shown, over-rejecting the neighbour. This world must PASS, and the
    // disagreeing tie above must keep failing.
    name: "A2 — a tie whose calls are graded identically settles nothing",
    mutate: (v) => {
      const write = v.streamMutations.find(
        (m) => m.path === "/work/repo/alpha.txt" && m.tool === "Write",
      );
      if (write !== undefined) {
        write.tool = "Edit";
        write.kind = "edited";
        write.at = 6;
      }
    },
    because: "a2-ok",
    id: "A2",
    want: "pass",
  },
  {
    // And the world it MUST accept, so the new branch is not simply "more than
    // one gap fails": the same relative spelling with ONE gap that matches.
    name: "A2 — a relatively-named lost mutation answered by a single matching gap",
    mutate: (v) => {
      v.did = v.did.filter((d) => !d.topic.endsWith("gamma.txt"));
      for (const m of v.streamMutations) {
        if (m.path.endsWith("gamma.txt")) m.path = "gamma.txt";
      }
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
    // Built from the ARRAYS, not by setting a count. The ambiguity is the
    // SPELLING, not the repetition: a bare `alpha.txt` could be this row or a
    // file in another directory, and nothing can say which.
    name: "A2 — a row is named by mutations on two different paths",
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
    // THE WORLD THIS ASSERTION USED TO REJECT, and the reason it would have
    // started failing ordinary runs: a run writes a file and then edits it. The
    // recorder folds both into one aggregate row. The fixture now carries it,
    // so the calibration proves it on every invocation — this case pins the
    // half that matters, which is WHICH call the row is compared against.
    //
    // The row here says `created`, matching the FIRST mutation. It must fail:
    // the row carries the last settlement, and a row still describing the write
    // after the edit landed is a stale record, not a faithful one.
    name: "A2 — an aggregate row reports the first call instead of the last",
    mutate: (v) => {
      const row = v.did.find((d) => d.path === "/work/repo/alpha.txt");
      if (row !== undefined) row.kind = "created";
    },
    because: "a2-kind-disagrees",
    id: "A2",
    want: "fail",
  },
  {
    // The terminal call has to be identifiable before the row can be compared
    // against it. An unreadable position on any of the folded mutations makes
    // it unrecoverable — grading the wrong one would assert the row is wrong
    // about a call it never described.
    name: "A2 — a folded mutation carries no readable position",
    mutate: (v) => {
      const edit = v.streamMutations.find((m) => m.path === "/work/repo/alpha.txt" && m.tool === "Edit");
      if (edit !== undefined) edit.at = null;
    },
    because: "a2-terminal-unreadable",
    id: "A2",
    want: "fail",
  },
  {
    // THE SIXTH SELF-INFLICTED DEFECT, AND A NEW SHAPE: TWO OF OUR OWN REPAIRS
    // INTERACTING. This world used to be the `a2-terminal-tied` case, and it
    // was the wrong world for it.
    //
    // `itemIndex` carries duplicates — the fixture has three at one position —
    // so a `Write` and an `Edit` on one path sharing the last position is a
    // real state. Against an `edited`/`applied` row BOTH grade clean: the
    // `Edit` matches, and the `Write` contributes `null` kind, which the
    // indeterminate-`Write` repair made mean *no claim*. Nothing downstream can
    // tell the two candidates apart, so which one the row settled on cannot
    // matter — and the first version of the tie check compared SERIALIZED
    // VALUES, got two distinct strings, and rejected faithful concurrent state.
    //
    // Identity where compatibility was meant. Each repair is right alone; only
    // together do they produce the false red — which is why per-repair care
    // could not have caught it, and a per-case must-pass neighbour can.
    name: "A2 — a tied Write and Edit that both grade clean against the row",
    mutate: (v) => {
      for (const m of v.streamMutations) {
        if (m.path === "/work/repo/alpha.txt") m.at = 6;
      }
    },
    because: "a2-ok",
    id: "A2",
    want: "pass",
  },
  {
    // And the tie that must STILL fail, because the candidates genuinely
    // disagree: two `Edit` calls at the last position, one completed and one
    // failed. Against an `edited`/`applied` row the first grades clean and the
    // second reports `a2-outcome-disagrees`, so the row's verdict really does
    // depend on which call it settled on — and the stream cannot say.
    //
    // Without this case, "stop failing on ties" would be indistinguishable from
    // the fix.
    name: "A2 — a tie whose candidates reach different verdicts",
    mutate: (v) => {
      const alpha = v.streamMutations.filter((m) => m.path === "/work/repo/alpha.txt");
      for (const m of alpha) {
        m.at = 6;
        m.tool = "Edit";
        m.kind = "edited";
      }
      if (alpha.length > 0) {
        alpha[0].status = "failed";
        alpha[0].outcome = "failed";
      }
    },
    because: "a2-terminal-tied",
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
    // Selected by PATH rather than by array index. Indexed at `[0]` it silently
    // stopped expressing its condition the moment the fixture gained a second
    // call on that path: `[0]` was no longer the mutation the row is compared
    // against, and the world graded clean. The guard table caught it.
    name: "A2 — the stream cannot say how a mutation ended and the row claims applied",
    mutate: (v) => {
      const only = v.streamMutations.find((m) => m.path === "/work/repo/beta.txt");
      if (only !== undefined) {
        only.status = "in_progress";
        only.outcome = null;
      }
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
  {
    // THE ONE ON THE HOT PATH. `toolCalls === 0` is true on every real run
    // (FIX-1185), so this is the branch every verdict this goal has produced
    // went through — and selecting the ROWS arm on `rows.length > 0` alone
    // meant a single spurious row would have been certified `a5-ok` with
    // nothing in the stream behind it. Rows without calls are reported, not
    // failed: the stream may be blind to how they got there, and that is a
    // can't-tell in the other direction.
    name: "A5 — plan rows exist and the run invoked no plan tool",
    mutate: (v) => {
      v.plan = {
        rows: [{ title: "write the ledger", status: "completed", previousStatus: "in_progress" }],
        toolCalls: 0,
      };
    },
    because: "a5-unmeasured",
    id: "A5",
    want: "unmeasured",
  },

  // ── A6 ──────────────────────────────────────────────────────────────────
  {
    // THE WORLD A6 USED TO FAIL: a run that hands its file work to a sub-agent.
    // Every mutation is nested, so the top-level tool_output count is zero —
    // and A6 required it to be non-zero, reporting a run that did everything it
    // was asked as having "reported without doing anything". Activity is
    // scanned over every item precisely so this run reads correctly, which is
    // what made the requirement a contradiction rather than a strict rule.
    //
    // This case exists so the row cannot come back quietly. It is the positive
    // direction: the count is zero and A6 must PASS.
    name: "A6 — the run delegated every tool call to a sub-agent",
    mutate: (v) => {
      v.counts.toolOutputs = 0;
    },
    because: "a6-ok",
    id: "A6",
    want: "pass",
  },
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
  // A8 is a pure source scan, so its verdict is FINAL here — before a run is
  // dispatched. Leaving it out of the pre-dispatch gate cost a full
  // model-backed coding run to return a failure already in hand. Not a
  // correctness defect: the verdict was right either way. It is wrong-extent on
  // the GATE, which exists for exactly one reason — never spend a run the goal
  // cannot pass — and did not include one of the failures it already knew.
  if (a8.status === "fail") failures.push(`A8/${a8.because} — ${a8.message}`);

  // ══ Precondition 1b — calibration against a state whose account is known ══
  const state = JSON.parse(readFileSync(fixturePath(import.meta.url, "known-state.json"), "utf8")) as KnownState;
  const knownAccount = JSON.parse(
    readFileSync(fixturePath(import.meta.url, "known-account.json"), "utf8"),
  ) as Account;

  let derived: Account;
  try {
    derived = await readAccount(calibrationRead(state), state.childSessionId);
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
  //
  // `existedBefore` mirrors what a harness would know about this synthetic
  // directory, and the three are chosen to exercise all three arms of the
  // ground-truth check model-free: `beta.txt` existed and its row says
  // `edited`, so the impossible-create branch is live and green; `alpha.txt`
  // did not exist and is named by TWO mutations, so the aggregate's `edited`
  // is legitimate and the created-check correctly stands down; `gamma.txt` did
  // not exist and its single call FAILED, so it stands down for the other
  // reason. The positive arm — one applied call on a path that did not exist
  // must read `created` — is exercised by every real run's two create targets.
  const calibrationExpectation: Expectation = {
    paths: ["alpha.txt", "beta.txt", "gamma.txt"],
    existedBefore: { "alpha.txt": false, "beta.txt": true, "gamma.txt": false },
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
  const lossyAccount = await readAccount(calibrationRead(lossy), lossy.childSessionId);
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

  // ══ Precondition 1c-ter — the ordering set covers the SUB-AGENTS ══════════
  // A3 says the request's stream is in order. It was measured over the
  // top-level projection until a review caught it, so a nested pair arriving
  // `3, 2` between two in-order messages passed. The fix is in the reader —
  // which items feed `indices` — and a guard case cannot reach it, because a
  // case is handed a view whose array is already built.
  //
  // So the pin lives here, and it is checked rather than assumed: the fixture
  // carries a nested item, and its position must appear in the derived set.
  // Without this, deleting that one item from the fixture would silently
  // retire the only thing holding the broader scope in place.
  const calibrationItems =
    (state.requests as { requests?: Array<{ id?: string; items?: StoredCalItem[] }> }).requests
      ?.find((r) => r.id === CALIBRATION_RUN_ID)?.items ?? [];
  const nested = calibrationItems.filter(
    (i) => i.ownedBy !== undefined && i.ownedBy !== null && typeof i.itemIndex === "number",
  );
  if (nested.length === 0) {
    failures.push(
      `CALIBRATION FAILED — the calibration state carries no positioned sub-agent item, so ` +
        `nothing holds A3's set open past the top-level thread`,
    );
  } else {
    const missing = nested.filter(
      (i) => !gradedKnownRun.order.indices.includes(i.itemIndex as number),
    );
    if (missing.length > 0) {
      failures.push(
        `CALIBRATION FAILED — ${missing.length} sub-agent item(s) at position(s) ` +
          `${missing.map((i) => i.itemIndex).join(", ")} are absent from the ordering set, so A3 ` +
          `would certify an order over a subset of the stream it names`,
      );
    }
  }

  // ══ Precondition 1d — every guard broken on purpose, and observed ═════════
  for (const guard of GUARD_CASES) {
    const clone = structuredClone(knownRuns[0]);
    const mutated = guard.mutate(clone) ?? clone;
    const findings = gradeRun(mutated, guard.expectation ?? calibrationExpectation, COLLECTIONS);
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
      name: "A0 — the child session has no request history",
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

  // ══ Precondition 1f — A3's disclosed toothlessness is still the truth ═════
  // A3 says the request's stream is in order. The list it reads arrives from
  // `store.request.list({ withItems: true })`, and this store returns items
  // ORDER BY the very field A3 grades — so on the real path A3 is satisfied
  // before the run is consulted, and its contribution to every PASS in the
  // verdict log is zero. That is stated in `goal.md`'s verdict section.
  //
  // It is EXECUTED here rather than remembered, because the claim lives one
  // level below anything a guard case or the calibration fixture can reach:
  // both are handed state directly, so everything between the emitter and the
  // grader — including the sort — is stubbed out. That invisibility is how the
  // defect survived twenty-six PASSes, and prose about it would decay the same
  // way for the same reason.
  //
  // Both directions are live, which is the point of writing it as a check at
  // all. Sorted means the disclosure stands. UNSORTED means the storage layer
  // changed under us, A3 has teeth on the real path again, and the verdict
  // section is now understating what the run proves — so it fails and says so,
  // rather than letting the goal quietly go on under-reporting itself.
  const sortProbeDir = mkdtempSync(join(tmpdir(), "state-readback-sortprobe-"));
  const { sqliteStores: probeStores } = await import("@flow-state-dev/store-sqlite");
  const adapter = probeStores({ filename: join(sortProbeDir, "sort-probe.sqlite") });
  try {
    const registry = (await adapter.resolve(["primary"])) as unknown as {
      request: {
        set(id: string, value: unknown, expected: "any"): Promise<unknown>;
        persistItems(id: string, items: unknown[]): void;
        flushItems(id: string): Promise<void>;
        list(options: { withItems: true }): Promise<Array<{ items?: Array<{ itemIndex?: number }> }>>;
      };
    };
    const probeId = "req_sort_probe";
    const now = Date.now();
    await registry.request.set(
      probeId,
      {
        id: probeId,
        state: {},
        version: 1,
        createdAt: now,
        updatedAt: now,
        flowKind: FLOW_KIND,
        actionName: "sort-probe",
        userId: USER_ID,
        source: "http",
        status: "completed",
        startedAtMs: now,
      },
      "any",
    );
    // Written in the order `1, 0` — the shape a broken emitter produces, and
    // the one A3 exists to catch.
    //
    // The IDS matter and are chosen deliberately: the write path sorts each
    // batch by `item.id`, so ids whose alphabetical order agrees with the index
    // would leave the rows already in index order on disk, and this probe would
    // report the disclosure holding on the strength of insertion order rather
    // than of the read's ORDER BY. `a` carries the later index so the two
    // orderings contradict, and only the sort on the way out can produce `0, 1`.
    // Caught by running the probe's other direction: with agreeing ids it went
    // silent against a read that did no sorting at all.
    registry.request.persistItems(probeId, [
      { id: "item_probe_a", type: "message", status: "completed", requestId: probeId, itemIndex: 1, ts: now },
      { id: "item_probe_b", type: "message", status: "completed", requestId: probeId, itemIndex: 0, ts: now },
    ]);
    await registry.request.flushItems(probeId);
    const readBack = (await registry.request.list({ withItems: true }))[0]?.items ?? [];
    const positions = readBack.map((i) => i.itemIndex);
    const asWritten = positions.length === 2 && positions[0] === 1 && positions[1] === 0;
    if (asWritten) {
      failures.push(
        `THE A3 DISCLOSURE IS STALE — items written out of order (1, 0) read back as written, so ` +
          `the store no longer sorts them and A3 CAN fail on the real path. goal.md's verdict ` +
          `section says its contribution to every PASS is zero; that is now understating the run`,
      );
    } else if (!(positions.length === 2 && positions[0] === 0 && positions[1] === 1)) {
      failures.push(
        `the item-order probe read back ${JSON.stringify(positions)} from a two-item write, which ` +
          `is neither the written order nor the sorted one — A3's disclosure cannot be checked ` +
          `against a store whose read path is doing something else entirely`,
      );
    }
  } finally {
    await adapter.dispose?.();
    rmSync(sortProbeDir, { recursive: true, force: true });
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
        detached: true,
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
    workers: {
      [ASSIGNEE]: {
        worker: codingRun,
        session: {
          key: (task) =>
            typeof task.metadata?.topic === "string" ? task.metadata.topic : task.taskId,
        },
      },
    },
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
    tasks: board.tasks,
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
    let children: ChildSessionRow[] = [];
    while (Date.now() < deadline) {
      const body = (await read(`/sessions/${PARENT_SESSION_ID}/children`)) as {
        children?: ChildSessionRow[];
      };
      children = body?.children ?? [];
      if (children.length > 0 && children.every((w) => w.status !== "active")) break;
      await sleep(POLL_INTERVAL_MS);
    }

    const child = children[0];
    if (child === undefined) {
      return {
        failures: [
          `no child session was started for ${PARENT_SESSION_ID} within ${RUN_TIMEOUT_MS}ms — the ` +
            `coding run never got its own place in the system, so there is no state to read`,
        ],
        evidence: "",
      };
    }
    if (child.status === "active") {
      return {
        failures: [
          `the child session was still active after ${RUN_TIMEOUT_MS}ms — grading a half-finished ` +
            `run would produce a partial verdict, so this aborts instead`,
        ],
        evidence: "",
      };
    }

    // ══ Derive, then compare ════════════════════════════════════════════════
    // The reader has never seen `expectation`, and from here nothing else
    // touches the routes.
    const account = await readAccount(read, child.id);
    // This check grades ONE run, and names which. The expectation was given to
    // the run this goal dispatched; a child session holding more than one request
    // has runs no expectation can be attributed to, and grading it anyway would
    // be a claim wider than the measurement.
    if (account.counts.requests !== 1) {
      return {
        failures: [
          `the child session holds ${account.counts.requests} request(s) and this check grades one ` +
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
    // The harness made `workDir` fresh and seeded exactly `fixture.editPath`, so
    // it knows which of these existed before the run began. That knowledge is
    // introduced HERE, after the account exists — the reader never sees it, and
    // the inversion this goal is built on is preserved.
    const expectation: Expectation = {
      paths: expectedNames,
      existedBefore: Object.fromEntries(
        expectedNames.map((name) => [name, name === fixture.editPath]),
      ),
    };
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
    console.log(`\nACCOUNT — child session ${child.id}, run ${view.runId}`);
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
    // How many cursors A7 actually had to follow: one page per collection means
    // none were offered, and A7 graded a claim nothing could falsify.
    const cursorsFollowed = COLLECTIONS.reduce(
      (n, c) => n + Math.max(0, (view.reads[c]?.pages ?? 1) - 1),
      0,
    );
    return {
      failures: graded,
      evidence:
        `a real coding run was dispatched into child session ${child.id} (status ` +
        `"${child.status}") and reconstructed from FSD state alone — the requests route with ` +
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
        `run's prose, the files' contents and the working tree were never read. ` +
        // A3 is structurally satisfied on this path and certifies nothing about
        // this run — see goal.md's verdict section. A7's half is COMPUTED rather
        // than asserted, and the wording BRANCHES on the count: it followed as
        // many cursors as the route offered, which on a run this size is none.
        // The moment a collection does page, this sentence stops saying two and
        // starts reporting the cursors A7 actually followed — which is the only
        // form of disclosure that cannot go stale while the log fills with green.
        (cursorsFollowed === 0
          ? `Two of the eight assertions certify nothing about this run: A3 grades a field the ` +
            `store returns sorted by, and A7 followed 0 cursor(s) because every collection fitted ` +
            `in one page.`
          : `One of the eight assertions certifies nothing about this run: A3 grades a field the ` +
            `store returns sorted by. A7 followed ${cursorsFollowed} cursor(s) on this run, so it ` +
            `graded a real read — the structural satisfaction recorded in goal.md no longer holds ` +
            `and that entry needs revisiting.`),
    };
  } finally {
    await host.close();
    rmSync(workDir, { recursive: true, force: true });
  }
});
