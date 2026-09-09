/**
 * Type-level test for the park-exit verdict's adjacency guard (FIX-1238).
 *
 * This lives under `src/` on purpose — this package's `typecheck` runs `tsc -p
 * tsconfig.json`, whose `include` is `src/**` only, and vitest transpiles test
 * files without checking types. Same convention as
 * `src/tasks/collection/tests/task-caps.type-test.ts`. A `@ts-expect-error`
 * placed in `test/` would be inert: nothing typechecks that directory.
 *
 * What it pins down: `boardExitsConnector` still has teeth. The connector is the
 * only thing making the drain's completion tap reject a step wired in front of
 * it (`task-board/index.ts`), and its guard is invisible from anywhere
 * downstream — the drain leaves its own module as `SequencerDefinition<any,
 * any>`, so the connector's only observable effect is on the compilation of its
 * own file. No runtime test and no miniature copy of the pipeline can observe
 * it, so a silent widening of the parameter back to `any` would take the guard's
 * value to zero with nothing going red.
 *
 * So this test holds the real binding directly. Weaken the connector to
 * `(exits: any) => exits` and the call below stops erroring, the directive goes
 * unused, and the package typecheck fails with TS2578 — the only signal that
 * erosion has happened.
 */
import { boardExitsConnector } from "../exits-connector";

// @ts-expect-error - the completion-tap connector must reject a non-exits input
boardExitsConnector({ totallyDifferent: "x" });
