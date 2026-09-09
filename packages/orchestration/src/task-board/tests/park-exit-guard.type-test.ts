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
 * it, so a silent widening of the parameter would take the guard's value to zero
 * with nothing going red.
 *
 * So this test holds the real binding directly, and asserts on BOTH halves of
 * the parameter type. A step wired in front of the tap produces an array either
 * way, so the ELEMENT type is what actually separates the pool's exit outputs
 * from something else — it is the half worth guarding:
 *
 * - widen to `(exits: any) => exits` and both calls below stop erroring
 * - widen to `(exits: readonly unknown[]) => exits` and the element assertion
 *   stops erroring while the non-array one still passes — so without that second
 *   assertion, this erosion is completely silent and an inserted step producing
 *   an incompatible array sails through
 *
 * Either way an unused directive fails the package typecheck with TS2578, which
 * is the only signal that erosion has happened.
 */
import { boardExitsConnector } from "../exits-connector";

// @ts-expect-error - the completion-tap connector must reject a non-array input
boardExitsConnector({ totallyDifferent: "x" });

// @ts-expect-error - and must reject an array whose elements are not exit outputs
boardExitsConnector([{ totallyDifferent: "x" }]);
