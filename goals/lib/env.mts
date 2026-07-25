/**
 * The intent-ladder env strip — one correct implementation.
 *
 * A goal that builds its own bare `createModelResolver()` (no declared intents)
 * throws at construction if the ambient environment pins the intent ladder:
 * `FSDEV_DEFAULT_MODEL` set with no intents declared is an error, and so is any
 * `FSDEV_INTENT_*` that can't be matched against the declared set. Containers
 * routinely set both, so ten goal runners have to clear them.
 *
 * They previously did it three different ways, and two of them deleted only
 * `FSDEV_INTENT_PLAN` / `FSDEV_INTENT_REASON` by name — leaving those goals to
 * throw on an unrelated resolver error the moment the environment sets
 * `FSDEV_INTENT_CHAT` or `FSDEV_INTENT_UTILITY`. This module prefix-strips, so
 * the whole family is covered whatever new intents get added.
 *
 * Note the alternative a goal may legitimately prefer: DECLARE the intents
 * instead of stripping them (`createModelResolver({ intents: {...} })`), which
 * `resource-collections` does because it wants the ambient gateway wiring. Use
 * that when the goal needs the ladder; use this when it doesn't.
 */

/** True for an env var that pins the model intent ladder. */
function isIntentOverride(key: string): boolean {
  return key === "FSDEV_DEFAULT_MODEL" || key.startsWith("FSDEV_INTENT_");
}

/**
 * A copy of `base` with every intent-ladder override removed — for handing to a
 * child process (`execFileSync`/`spawnSync` `env`). Also drops `undefined`
 * values, which `NodeJS.ProcessEnv` permits but the child-process env option
 * does not represent faithfully.
 */
export function intentFreeEnv(
  base: NodeJS.ProcessEnv = process.env,
  extra: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || isIntentOverride(key)) continue;
    out[key] = value;
  }
  return { ...out, ...extra };
}

/**
 * Snapshot the intent-ladder overrides currently set, BEFORE stripping them.
 *
 * Needed by a goal that does both: builds a bare resolver in-process (which
 * requires the parent env stripped) AND later shells out to an app that should
 * run on the caller's configured ladder. Without the snapshot, the in-process
 * strip silently changes which model the child resolves — see the usage in
 * `goal-seek-loop/replans-until-done`.
 */
export function captureIntentOverrides(
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && isIntentOverride(key)) out[key] = value;
  }
  return out;
}

/**
 * Strip the intent-ladder overrides from THIS process's env, in place. For
 * goals that build a resolver in-process rather than shelling out. Call it
 * before the first import that constructs a resolver at module scope.
 *
 * NOTE this mutates the parent env, so any child process spawned afterwards
 * inherits the stripped ladder too. If the goal also shells out to an app that
 * should keep the caller's ladder, snapshot it first with
 * {@link captureIntentOverrides} and pass it back to that child explicitly.
 */
export function stripIntentOverrides(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of Object.keys(env)) {
    if (isIntentOverride(key)) delete env[key];
  }
}
