/**
 * How a teammate looks: its bot's face and its color, from the `icon:` and
 * `color:` lines of its worker file, which ride on its roster entry. `icon:`
 * names one of the bot faces; a teammate that names none (or an older
 * glyph, such as "★") gets a face picked from its id, and one that names no
 * color, or one the palette doesn't have, gets a color picked from its id,
 * so the same teammate always looks the same.
 *
 * The bot shows a state too ({@link BotStatus}): what the teammate is doing,
 * which wins over its color (a teammate that needs you is drawn on the
 * highlighter, whatever its color).
 */

/** The bot faces, each its own head on the 64×64 grid (`components/Avatar.tsx`). */
export const BOT_FACES = ["pip", "tally", "bolt", "dot", "hex", "sprocket", "visor", "dome", "pod", "telly", "chip"] as const;
export type BotFace = (typeof BOT_FACES)[number];

/**
 * The team palette a worker file may name. Each is three theme tokens,
 * `--team-<name>-tile | -mark | -surface`. No yellow-green: that is the
 * highlighter's, and means the user needs to act.
 */
export const TEAMMATE_COLORS = ["coral", "amber", "mint", "teal", "iris", "orchid", "rose", "slate"] as const;
export type TeammateColor = (typeof TEAMMATE_COLORS)[number];

/** The earlier palette's names, read as the nearest of this one, so a file or a hire that names one keeps its color. */
const FORMER_COLORS: Readonly<Record<string, TeammateColor>> = { blue: "iris", green: "mint", violet: "orchid" };

/** How a teammate's bot shows what it is doing: answering or coding, waiting on you, waiting on someone else, just finished, or nothing. */
export type BotStatus = "running" | "needs" | "queued" | "done" | "idle";

/** A teammate's face and color, filled in. */
export interface Look {
  face: BotFace;
  color: TeammateColor;
}

const isFace = (value: unknown): value is BotFace => BOT_FACES.includes(value as BotFace);

/** A stable pick from `from` for a teammate's id. */
function pick<T>(id: string, from: readonly T[]): T {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return from[hash % from.length]!;
}

/** The palette's color a worker file names, a former name read as its new one, else `undefined`. */
function colorNamed(value: string | undefined): TeammateColor | undefined {
  const name = value?.trim().toLowerCase();
  if (name === undefined) return undefined;
  if (TEAMMATE_COLORS.includes(name as TeammateColor)) return name as TeammateColor;
  return FORMER_COLORS[name];
}

/** A teammate's look: what its file sets, else a face and a color of its own. */
export function lookOf(worker: { id: string; name: string; icon?: string; color?: string }): Look {
  const face = worker.icon?.trim().toLowerCase();
  return {
    face: isFace(face) ? face : pick(worker.id, BOT_FACES),
    color: colorNamed(worker.color) ?? pick(worker.id, TEAMMATE_COLORS),
  };
}
