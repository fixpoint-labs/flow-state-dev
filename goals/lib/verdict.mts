/**
 * The goal-check verdict protocol — one verdict shape for every runner.
 *
 * README "Script techniques" #5 requires every goal to print an explicit
 * verdict and exit non-zero unless it passed. Before this module each runner
 * hand-rolled it, and five different FAIL formats drifted into the corpus. This
 * is the single definition, with three verdicts:
 *
 *   - `PASS — <evidence> · read: …` on stdout, exit 0.
 *   - `FAIL —` plus a bulleted failure list on stderr, exit 1.
 *   - `CAN'T TELL —` plus one bullet per assertion that read nothing, on
 *     stderr, exit {@link CANT_TELL_EXIT}. The check was blind: it did not see
 *     the thing it claims to measure, so it neither passed nor failed. A run
 *     with both a failure and a can't-tell prints both and exits as FAIL.
 *
 * Two usage shapes, matching how goals are actually written:
 *   - `runGoal(main)` for the common "collect failures, then decide" body;
 *     `main` collects into the list it is handed, so a later throw keeps them,
 *     and floors each assertion's evidence with the {@link Tell} it is handed.
 *   - `fail(msg)` (returns `never`) to bail out mid-flight on a setup error.
 */

/** What a goal's `main` reports back: why it failed, or what proves it passed. */
export interface GoalResult {
  /** Empty means PASS. Each entry is one bullet under `FAIL —`. */
  failures: string[];
  /** The evidence inspected, printed after `PASS —`. Ignored when failing. */
  evidence: string;
}

/**
 * The exit code of a CAN'T TELL verdict. Its own code, neither 0 nor 1, so
 * `goal:all` tells a blind check from a failing one without parsing output.
 */
export const CANT_TELL_EXIT = 3;

/** Options for one {@link Tell.over} floor. */
export interface TellOptions {
  /**
   * Set only when an empty list IS the claim ("no session leaks", "no stray
   * row"): the reason, printed in the PASS evidence where a reviewer can
   * challenge it. Floor the population this list was filtered from with its
   * own `tell.over`, so an absence claim still read something.
   */
  emptyIs?: string;
}

/** Handed to the goal body. Floor each graded list with `over`; an empty read is CAN'T TELL. */
export interface Tell {
  /**
   * Record that the assertion `name` reads `values`, and return `values`
   * unchanged. If it is empty (and `emptyIs` isn't set), the run reports
   * CAN'T TELL naming `name` instead of PASS. Calling it again with the same
   * name adds to that name's count; an empty read is a can't-tell unless
   * that same call set `emptyIs`.
   */
  over<T>(name: string, values: readonly T[], options?: TellOptions): T[];
}

interface Reading {
  read: number;
  calls: number;
  /** Empty reads whose own call did not set `emptyIs`. */
  blindCalls: number;
  emptyIs?: string;
}

/** A fresh {@link Tell} and the readings it records, in first-call order. */
function createTell(): { tell: Tell; readings: Map<string, Reading> } {
  const readings = new Map<string, Reading>();
  const tell: Tell = {
    over(name, values, options) {
      const entry = readings.get(name) ?? { read: 0, calls: 0, blindCalls: 0 };
      entry.read += values.length;
      entry.calls += 1;
      if (options?.emptyIs !== undefined) entry.emptyIs = options.emptyIs;
      else if (values.length === 0) entry.blindCalls += 1;
      readings.set(name, entry);
      return [...values];
    },
  };
  return { tell, readings };
}

/** One bullet per assertion that read nothing and did not declare empty the claim. */
function cantTellLines(readings: Map<string, Reading>): string[] {
  const lines: string[] = [];
  for (const [name, r] of readings) {
    if (r.blindCalls === 0) continue;
    lines.push(r.calls === 1 ? `${name}: read 0` : `${name}: read 0 in ${r.blindCalls} of ${r.calls} reads`);
  }
  return lines;
}

/** The `read:` clause of a PASS: what each assertion read, and how many. */
function readClause(readings: Map<string, Reading>): string {
  const parts = [...readings].map(([name, r]) =>
    r.read === 0 && r.emptyIs !== undefined
      ? `${name}: 0, empty is ${r.emptyIs}`
      : `${name}: ${r.read}${r.emptyIs !== undefined ? ` (empty is ${r.emptyIs})` : ""}`,
  );
  return parts.length === 0 ? "" : ` · read: ${parts.join("; ")}`;
}

/** Print the PASS verdict with the evidence inspected and exit 0. */
export function pass(evidence: string): never {
  console.log(`PASS — ${evidence}`);
  process.exit(0);
}

/**
 * Print the FAIL verdict and exit 1. Accepts loose strings and/or arrays so
 * both `fail("setup broke")` and `fail(failures)` read naturally. Empty and
 * whitespace-only entries are dropped; if nothing survives, a placeholder keeps
 * the output from being a bare `FAIL —`.
 */
export function fail(...failures: (string | string[])[]): never {
  const lines = failures.flat().filter((f) => f != null && String(f).trim().length > 0);
  const body = lines.length > 0 ? lines : ["goal failed with no reported reason"];
  console.error("FAIL —\n  - " + body.join("\n  - "));
  process.exit(1);
}

/** Print the CAN'T TELL verdict, one bullet per blind assertion, and exit {@link CANT_TELL_EXIT}. */
function cantTell(lines: string[]): never {
  console.error("CAN'T TELL —\n  - " + lines.join("\n  - "));
  process.exit(CANT_TELL_EXIT);
}

/**
 * Run a goal body and turn its `GoalResult` into the verdict + exit code.
 * A throw is itself a FAIL (with the stack), so runners no longer need their
 * own `main().catch(...)` tail — which previously reported thrown errors in
 * three different formats.
 *
 * `main` receives the failure list the runner reads if it throws. A goal that
 * pushes its legs' failures there keeps them when a later leg throws: the
 * verdict lists the legs that already graded, then the throw. Otherwise a
 * later leg's setup error (often caused by the earlier failure) would be
 * reported as the whole story. On a normal return the returned `failures` is
 * what counts, so a body that returns a copy or a literal list is unaffected.
 */
export async function runGoal(
  main: (failures: string[], tell: Tell) => GoalResult | Promise<GoalResult>,
): Promise<never> {
  const graded: string[] = [];
  const { tell, readings } = createTell();
  let result: GoalResult;
  try {
    result = await main(graded, tell);
  } catch (err) {
    const thrown = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    result = { failures: graded.length === 0 ? [thrown] : [...graded, `then threw: ${thrown}`], evidence: "" };
  }
  const blind = cantTellLines(readings);
  if (result.failures.length > 0) {
    return fail(result.failures, blind.map((l) => `CAN'T TELL: ${l}`));
  }
  if (blind.length > 0) return cantTell(blind);
  return pass(`${result.evidence}${readClause(readings)}`);
}
