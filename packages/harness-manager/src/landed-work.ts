// FIX-2725.
/**
 * Where an accepted coding run's work went, as its output's `landed` records
 * it: a pull request opened, or a merge into the user's checkout. One reader,
 * shared by the coding board view and any screen that reads a task's output.
 */

/** Where an accepted run's work went. */
export type LandedWork =
  | { kind: "pull-request"; url: string; number: number; branch: string; base: string }
  | { kind: "merge"; branch: string; commit: string; checkout: string; from: string };

/** Where an accepted run's work went, from its output's `landed`, or `undefined` when it names none readable. */
export function landedOf(value: unknown): LandedWork | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (v.kind === "pull-request" && typeof v.url === "string" && typeof v.number === "number" && typeof v.branch === "string" && typeof v.base === "string") {
    return { kind: "pull-request", url: v.url, number: v.number, branch: v.branch, base: v.base };
  }
  if (v.kind === "merge" && typeof v.branch === "string" && typeof v.commit === "string" && typeof v.checkout === "string" && typeof v.from === "string") {
    return { kind: "merge", branch: v.branch, commit: v.commit, checkout: v.checkout, from: v.from };
  }
  return undefined;
}
