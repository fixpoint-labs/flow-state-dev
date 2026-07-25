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
 * Strip the intent-ladder overrides from THIS process's env, in place. For
 * goals that build a resolver in-process rather than shelling out. Call it
 * before the first import that constructs a resolver at module scope.
 */
export function stripIntentOverrides(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of Object.keys(env)) {
    if (isIntentOverride(key)) delete env[key];
  }
}
