/**
 * The one gate every goal control passes through (`GOAL_CONTROL`).
 *
 * A control swaps real behaviour for a broken stand-in, so a goal check can be
 * seen to fail on the leg it names. **It never reaches a deployed build:** the
 * control is read only under `KITCHEN_SINK_TEST_MODE=1`, and every control in
 * `lib/` asks this function rather than reading the environment itself, so
 * that invariant lives in one place.
 */

/** The goal control in force, or `undefined` outside test mode or when none is set. */
export function goalControl(): string | undefined {
  if (process.env.KITCHEN_SINK_TEST_MODE !== "1") return undefined;
  const control = process.env.GOAL_CONTROL;
  return control === undefined || control === "" ? undefined : control;
}
