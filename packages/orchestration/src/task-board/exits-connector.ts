/**
 * The connector on the drain's completion tap (FIX-1238).
 *
 * The completion item reads the worker pool's own exit outputs for one fact it
 * cannot re-derive — whether the drain stopped because rows were excused as
 * parked for review (FIX-1234). That value reaches it only because the tap sits
 * directly after the worker `forEach`. This connector is the identity function,
 * so it changes nothing at run time; its job is to state the shape the tap
 * expects in a form the compiler checks, so wiring a step that carries a
 * different CONCRETE output in between fails the build at that line. A step
 * whose output type is already `any` still slips past; the tap's own comment in
 * `index.ts` spells out that residual and the three ways to land on it.
 *
 * It is a NAMED module rather than an inline arrow because a name is the only
 * handle a test can take: the drain leaves its own module as
 * `SequencerDefinition<any, any>`, so the connector's only observable effect is
 * on the compilation of this file. `tests/park-exit-guard.type-test.ts` holds
 * this binding directly for exactly that reason.
 *
 * Internal: deliberately NOT re-exported from `index.ts` (BP-004).
 */
import type { CheckBoardOutput } from "./schemas";

/** Identity connector that pins the completion tap's expected input shape. */
export const boardExitsConnector = (exits: readonly CheckBoardOutput[]) => exits;
