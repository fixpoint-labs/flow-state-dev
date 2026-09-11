/**
 * Compile-time half of the collision claim: `paths` is reachable on a
 * `duplicate-skill-name` entry and on no other one.
 *
 * The runtime tests in `read-seat-skills.test.ts` pin what the list contains.
 * They cannot pin the part that matters to a caller writing the `if`: that
 * `kind` narrows `SeatSkillError` to the variant carrying `paths`, and that the
 * other five conditions do not offer a `paths` to read — an optional field on
 * one flat shape would type-check everywhere and be `undefined` in five cases
 * out of six, which is the shape this union exists to avoid.
 *
 * Vitest strips types rather than checking them, and this package's `src`
 * typecheck does not include `test/`. So `tsconfig.test-d.json` compiles every
 * `.test-d.ts` file here, and the `typecheck` script runs it after the `src`
 * pass. Collapse the union back into one shape and the `@ts-expect-error`
 * below has nothing to suppress, which is itself an error (TS2578) — so
 * `pnpm typecheck` goes red.
 *
 * Imported through the `./loader` barrel rather than the module, so the type a
 * caller is told to narrow on is also proven to be exported.
 */
import type { SeatSkillError } from "../src/loader";

/** Narrowing on `kind` reaches the every-level list. */
export function collidingPaths(entry: SeatSkillError): string[] | undefined {
  return entry.kind === "duplicate-skill-name" ? entry.paths : undefined;
}

/** Outside that branch there is no `paths` to read — the half a runtime test cannot assert. */
export function noPathsOnTheRest(entry: SeatSkillError): unknown {
  if (entry.kind === "duplicate-skill-name") return entry.paths;
  // @ts-expect-error the other five conditions fail at one path and carry no `paths`.
  return entry.paths;
}

/** Every variant still keys by `path`: the union never drops the `PathReport` contract. */
export const key = (entry: SeatSkillError): string => entry.path;

/** Control — a collision entry is complete only with its list. */
export const collision: SeatSkillError = {
  kind: "duplicate-skill-name",
  path: "org/skills/triage",
  paths: ["org/skills/triage", "teams/pentest/skills/triage"],
  error: new Error("two levels"),
};

// @ts-expect-error a collision without `paths` is not a `SeatSkillError`.
export const collisionMissingPaths: SeatSkillError = {
  kind: "duplicate-skill-name",
  path: "org/skills/triage",
  error: new Error("two levels"),
};

/** Control — every other condition is unchanged: `path` and `error`, nothing added. */
export const unlistable: SeatSkillError = {
  kind: "unlistable-level",
  path: "teams/pentest/skills",
  error: new Error("could not be read"),
};
