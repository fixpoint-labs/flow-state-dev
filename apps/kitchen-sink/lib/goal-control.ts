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

/**
 * The goal control a page was opened with, for a control that lives in the
 * browser: a client component cannot read `GOAL_CONTROL`, so a goal run opens
 * the page with `?goalControl=<name>` instead. Read only in a build made with
 * `NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE=1`; any other build ignores the parameter.
 *
 * @param search The page's query parameters.
 */
export function pageGoalControl(search: { get(name: string): string | null }): string | undefined {
  if (process.env.NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE !== "1") return undefined;
  const control = search.get("goalControl");
  return control === null || control === "" ? undefined : control;
}
