/**
 * The harness feeds keep their type checking, and cannot see the prompt (LAB-154).
 *
 * `HarnessResolver` and `HarnessSessionHook` are the channel a manager hands a
 * harness its per-run configuration through, so two separate things have to hold
 * and each was broken once:
 *
 * 1. **A resolver's body stays checked.** Typed `any` in every context slot,
 *    every read off `ctx` came back `any`: a misspelled scope-state field, or
 *    one that was never declared, type-checked as whatever the reader wanted.
 * 2. **A resolver cannot reach the caller's input.** It used to be the first
 *    argument, which undid the reason the resolver exists — the prompt is the
 *    one value a caller or a tool-using model controls, and a resolver decides
 *    where a run writes and which conversation it continues (BP-031).
 *
 * These are negative assertions, which is what both regressions need: a positive
 * one compiles just as happily against `any`, and an unused parameter is
 * invisible to a test that only checks the return value.
 */
import type { AnyResourceRef, BlockContext } from "../src/types";
import type {
  HarnessResolver,
  HarnessRunInput,
  HarnessSessionHook,
} from "../src/types";

/** Scope state a harness's host never declared reads `unknown`, not `any`. */
export const scopeStateIsUnknown: HarnessResolver<string> = (ctx) => {
  // @ts-expect-error - `unknown` is not indexable; under `any` this was silent.
  const fromUser: string = ctx.user.state.neverDeclared.deeper;
  // @ts-expect-error - same, through the request scope.
  const fromRequest: string = ctx.request.state.neverDeclared.deeper;
  return `${fromUser}${fromRequest}`;
};

/** The same for the session hook, which is handed the same context. */
export const hookScopeStateIsUnknown: HarnessSessionHook = (_id, ctx) => {
  // @ts-expect-error - `unknown` is not indexable.
  void (ctx.org!.state.neverDeclared.deeper as string);
};

/**
 * **A resolver is handed one argument, and it is the context.**
 *
 * The assertion that matters is the arity: a two-parameter resolver must not
 * type-check, because the parameter it would be reaching for is the caller's
 * prompt. Declaring the input type here and refusing it is what keeps the
 * guarantee structural instead of documentary.
 */
// @ts-expect-error - the run's input is deliberately not a parameter (BP-031).
export const aResolverCannotTakeTheInput: HarnessResolver<string> = (
  _input: HarnessRunInput,
  _ctx: unknown,
) => "";

/**
 * What a manager's resolvers really read still compiles: the sequencer state
 * (cast, because a harness block carries the framework's default one — the
 * manager owns the shape, the harness does not), the resolved identity, and the
 * block's own signal.
 */
export const managerShapedReadsCompile: HarnessResolver<string | null> = (ctx) => {
  const state = ctx.sequencer?.state as
    | { workspacePath?: string; previousSessionId?: string | null }
    | undefined;
  const who: string = ctx.session.identity.id;
  const aborted: boolean = ctx.signal.aborted;
  return state?.previousSessionId ?? `${state?.workspacePath}${who}${aborted}`;
};

/**
 * A harness calls the resolver with ITS OWN context, which is narrower than the
 * declared one wherever the harness declared something — session state, above
 * all. Contravariance makes that the failure mode a too-tight declaration
 * produces, so it is asserted rather than assumed.
 */
declare const harnessOwnContext: BlockContext<
  Record<string, unknown>,
  { sdkSessionId: string | null; runs: readonly string[] },
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, AnyResourceRef>,
  Record<string, unknown>,
  unknown,
  undefined,
  Record<string, never>
>;

export const aHarnessCanCallIt: string | null | Promise<string | null> =
  managerShapedReadsCompile(harnessOwnContext);

export const aHarnessCanCallTheHook: void | Promise<void> =
  hookScopeStateIsUnknown("session-1", harnessOwnContext);
