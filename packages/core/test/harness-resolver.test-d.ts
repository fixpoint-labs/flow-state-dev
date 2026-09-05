/**
 * The harness feeds keep their type checking (LAB-154).
 *
 * `HarnessResolver` and `HarnessSessionHook` are the channel a manager hands a
 * harness its per-run configuration through, so a manager's resolver bodies are
 * ordinary code written against a block context — and the context they are
 * handed is the only thing keeping that code honest. Typed `any` in every slot,
 * every read off `ctx` came back `any`: a misspelled scope-state field, or one
 * that was never declared, type-checked as whatever the reader wanted.
 *
 * These are negative assertions, which is what the regression needs: a positive
 * one compiles just as happily against `any`.
 */
import type { AnyResourceRef, BlockContext } from "../src/types";
import type { HarnessResolver, HarnessSessionHook } from "../src/types";

/** Scope state a harness's host never declared reads `unknown`, not `any`. */
export const scopeStateIsUnknown: HarnessResolver<string> = (_input, ctx) => {
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
 * What a manager's resolvers really read still compiles: the sequencer state
 * (cast, because a harness block carries the framework's default one — the
 * manager owns the shape, the harness does not), the resolved identity, and the
 * block's own signal.
 */
export const managerShapedReadsCompile: HarnessResolver<string | null> = (
  _input,
  ctx,
) => {
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
  managerShapedReadsCompile({ prompt: "run it" }, harnessOwnContext);

export const aHarnessCanCallTheHook: void | Promise<void> =
  hookScopeStateIsUnknown("session-1", harnessOwnContext);
