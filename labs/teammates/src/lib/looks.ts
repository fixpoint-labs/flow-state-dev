/**
 * How a teammate looks: its icon and its color, from the `icon:` and `color:`
 * lines of its worker file, which ride on its roster row. A teammate that sets
 * neither still gets one of each: its initial, on a color picked from its id,
 * so the same teammate always looks the same.
 */

/** The colors a worker file may name. Each is a theme token (`--teammate-<name>`). */
export const TEAMMATE_COLORS = ["blue", "green", "amber", "rose", "violet", "teal"] as const;
export type TeammateColor = (typeof TEAMMATE_COLORS)[number];

/** A teammate's icon and color, filled in. */
export interface Look {
  icon: string;
  color: TeammateColor;
}

const isColor = (value: unknown): value is TeammateColor => TEAMMATE_COLORS.includes(value as TeammateColor);

/** A stable pick from the palette for a teammate that names no color, or one the palette doesn't have. */
function colorFor(id: string): TeammateColor {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TEAMMATE_COLORS[hash % TEAMMATE_COLORS.length]!;
}

/** A teammate's look: what its file sets, else its initial on its own color. */
export function lookOf(worker: { id: string; name: string; icon?: string; color?: string }): Look {
  const icon = worker.icon?.trim();
  return {
    icon: icon ? icon : worker.name.slice(0, 1).toUpperCase(),
    color: isColor(worker.color) ? worker.color : colorFor(worker.id),
  };
}
