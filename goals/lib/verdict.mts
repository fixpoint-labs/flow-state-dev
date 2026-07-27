/**
 * The goal-check verdict protocol — one PASS/FAIL shape for every runner.
 *
 * README "Script techniques" #5 requires every goal to print an explicit
 * verdict and exit non-zero on FAIL. Before this module each runner hand-rolled
 * it, and five different FAIL formats drifted into the corpus. This is the
 * single definition: `PASS — <evidence>` on stdout / exit 0, or `FAIL —` plus a
 * bulleted failure list on stderr / exit 1.
 *
 * Two usage shapes, matching how goals are actually written:
 *   - `runGoal(main)` for the common "collect failures, then decide" body.
 *   - `fail(msg)` (returns `never`) to bail out mid-flight on a setup error.
 */

/** What a goal's `main` reports back: why it failed, or what proves it passed. */
export interface GoalResult {
  /** Empty means PASS. Each entry is one bullet under `FAIL —`. */
  failures: string[];
  /** The evidence inspected, printed after `PASS —`. Ignored when failing. */
  evidence: string;
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

/**
 * Run a goal body and turn its `GoalResult` into the verdict + exit code.
 * A throw is itself a FAIL (with the stack), so runners no longer need their
 * own `main().catch(...)` tail — which previously reported thrown errors in
 * three different formats.
 */
export async function runGoal(
  main: () => GoalResult | Promise<GoalResult>,
): Promise<never> {
  let result: GoalResult;
  try {
    result = await main();
  } catch (err) {
    return fail(
      err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
    );
  }
  return result.failures.length === 0 ? pass(result.evidence) : fail(result.failures);
}
