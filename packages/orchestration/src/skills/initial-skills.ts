/**
 * What a skills library is seeded FROM — an array, or a function of the
 * execution that returns one.
 *
 * A library is built once and bound once; its `initialSkills` used to be fixed
 * at that moment. That is wrong for any consumer whose catalog is
 * per-INSTANCE rather than per-definition: two registered copies of one flow
 * are two different seats, and a copy-wide array would give them both the same
 * catalog no matter whose storage they read.
 *
 * The resolver is the seam that fixes it without teaching this layer what the
 * consumer's instances are. A caller says *where* its per-execution set lives
 * (`@flow-state-dev/workforce` reads a seat setting off `ctx.flow.config`);
 * nothing here learns what a seat is.
 *
 * **A resolver must be an O(1) read of something already resolved.** It runs on
 * every render of every binding — before every step of a generator's tool loop
 * — so walking a directory, parsing markdown or touching storage inside one
 * turns a per-turn path into a per-turn cost. Resolve the set upstream (at
 * configuration time) and read it here.
 */

import type { BlockContext } from "@flow-state-dev/core/types";
import type { InitialSkill } from "@flow-state-dev/core";

/**
 * Bundled defaults, as a fixed array or as a per-execution resolver.
 *
 * A resolver returning `undefined` (or an empty array) means "this execution
 * seeds nothing" — the seeding call sites return before any storage read.
 */
export type InitialSkillsSource =
  | InitialSkill[]
  | ((ctx: BlockContext) => InitialSkill[] | undefined);

/**
 * Resolve a source against one execution. The one call every seeding site goes
 * through, so "an array or a function" is spelled once.
 */
export function resolveInitialSkills(
  source: InitialSkillsSource | undefined,
  ctx: BlockContext,
): InitialSkill[] | undefined {
  return typeof source === "function" ? source(ctx) : source;
}

/** Whether a source defers to the execution — i.e. there is no build-time catalog. */
export function isInitialSkillsResolver(
  source: InitialSkillsSource | undefined,
): source is (ctx: BlockContext) => InitialSkill[] | undefined {
  return typeof source === "function";
}
