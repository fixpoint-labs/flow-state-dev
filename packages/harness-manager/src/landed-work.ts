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
  z.object({
    kind: z.literal("pull-request"),
    url: z.string(),
    number: z.number(),
    branch: z.string(),
    base: z.string(),
    // FIX-2884.
    /** What became of the pull request, as the settle that ended the task on it stamped it; absent while open or unread. */
    state: z.enum(["merged", "closed"]).optional(),
  }),
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
  if (landed.kind === "merge") return { kind: "merge", branch: landed.branch, commit: landed.commit, checkout: landed.checkout, from: landed.from };
  return {
    kind: "pull-request",
    url: landed.url,
    number: landed.number,
    branch: landed.branch,
    base: landed.base,
    ...(landed.state === undefined ? {} : { state: landed.state }),
  };
}

// FIX-2884.
/**
 * `landed` with what became of its pull request, from `read`, the settle's
 * reads: `state` once it merged or closed, nothing added while open or when
 * `read` doesn't hold it. Matched by address, since a number repeats across
 * repositories. A merge, or no landing, comes back as given.
 */
export function withSettledState<L extends { readonly kind: string; readonly url?: string }>(
  landed: L | null,
  read: ReadonlyArray<{ readonly url: string | null; readonly state: "open" | "merged" | "closed" }>,
): L | null {
  if (landed === null || landed.kind !== "pull-request" || landed.url === undefined) return landed;
  const found = read.find((pr) => pr.url === landed.url);
  return found === undefined || found.state === "open" ? landed : { ...landed, state: found.state };
}
