/**
 * The settings a user sees on a worker's roster row (FIX-2281): only the
 * ones its flow's registration names in `showSettings`.
 *
 * The one place a browser read of a worker's settings is made, for standard
 * workers and a user's own alike, so a setting no flow named never leaves the
 * server.
 */

/** Which settings a flow shows, by the flow's name; empty for a flow that names none or isn't registered. */
export type ShownSettingsOf = (flow: string) => readonly string[];

/**
 * The shown keys a worker sets, with its values; a key it doesn't set is
 * absent, not filled from the flow's default.
 *
 * @param shown The keys the worker's flow shows.
 * @param settings The worker's settings: its file's frontmatter, or its stored row's.
 */
export function shownSettingsOf(shown: readonly string[], settings: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of shown) if (Object.hasOwn(settings, key)) picked[key] = settings[key];
  return picked;
}
