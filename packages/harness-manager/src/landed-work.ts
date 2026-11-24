// FIX-2725.
/**
 * Where an accepted coding run's work went, as its output's `landed` records
 * it: a pull request opened, or a merge into the user's checkout. One reader
 * and one schema, shared by the coding board view and any screen that reads a
 * task's output.
 */
import { z } from "zod";

/** Where an accepted run's work went: the one shape the reader answers and the coding board declares. */
export const landedWorkSchema = z.union([
  z.object({ kind: z.literal("pull-request"), url: z.string(), number: z.number(), branch: z.string(), base: z.string() }),
  z.object({ kind: z.literal("merge"), branch: z.string(), commit: z.string(), checkout: z.string(), from: z.string() }),
]);

/** Where an accepted run's work went. */
export type LandedWork = z.infer<typeof landedWorkSchema>;

/** Where an accepted run's work went, from its output's `landed`, or `undefined` when it names none readable. */
export function landedOf(value: unknown): LandedWork | undefined {
  const parsed = landedWorkSchema.safeParse(value);
  if (!parsed.success) return undefined;
  // Only the shape's fields, never extra keys a run wrote beside them.
  const landed = parsed.data;
  return landed.kind === "pull-request"
    ? { kind: "pull-request", url: landed.url, number: landed.number, branch: landed.branch, base: landed.base }
    : { kind: "merge", branch: landed.branch, commit: landed.commit, checkout: landed.checkout, from: landed.from };
}
