import type { ResourceContext, ResourceRef } from "../resource";

/**
 * Type test: `incState` / `pushState` are typed against the resource's own
 * state shape, and BOTH handle types carry BOTH verbs. Compile-time only —
 * never executed.
 *
 * This is what keeps `ResourceRef` and `ResourceContext` in step. Extracting a
 * shared base type would make the drift structurally impossible, but it
 * refactors two heavily-consumed public declarations for a two-method addition;
 * these rows buy the same guarantee for far less.
 *
 * **Written against an explicit state type on purpose.** Asserting through
 * `defineResource(...).StateType` would pass vacuously: that resolves to `any`,
 * which is mutually assignable with everything, so every `Same<>` row below
 * would go green no matter what the signatures said. The checking pinned here
 * is what a hand-written state type gets — the `ResourceContext<MyState>` idiom
 * used across `packages/memory` and `@thought-fabric/core`.
 */

type Expect<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type UsageState = {
  calls: number;
  tokens: number;
  label: string;
  errors: string[];
  tags: string[] | null;
};

declare const ref: ResourceRef<UsageState>;
declare const ctx: ResourceContext<UsageState>;

// --- Both handle types expose the same mutation verb set ---

type MutatorNames = "patchState" | "setState" | "updateState" | "incState" | "pushState";
type _RefHasEveryMutator = Expect<
  Same<Extract<keyof ResourceRef<UsageState>, MutatorNames>, MutatorNames>
>;
type _CtxHasEveryMutator = Expect<
  Same<Extract<keyof ResourceContext<UsageState>, MutatorNames>, MutatorNames>
>;

// ...and the two verbs mean the same thing on both, not merely exist on both.
type _IncIdentical = Expect<
  Same<ResourceRef<UsageState>["incState"], ResourceContext<UsageState>["incState"]>
>;
type _PushIdentical = Expect<
  Same<ResourceRef<UsageState>["pushState"], ResourceContext<UsageState>["pushState"]>
>;

// --- incState: a partial keyed to number-valued fields ---

void ref.incState({ calls: 1 });
void ref.incState({ calls: 1, tokens: -2 });

// @ts-expect-error `label` holds a string, so it is not an increment target.
void ref.incState({ label: 1 });
// @ts-expect-error a delta is a number, not a string.
void ref.incState({ calls: "1" });
// @ts-expect-error a field that does not exist on the state is a build error.
void ref.incState({ missing: 1 });

// --- pushState: the named field's element type ---

void ref.pushState("errors", "rate_limited");
// A nullable array field is still pushable — `null` is its empty state.
void ref.pushState("tags", "beta");

// @ts-expect-error `calls` holds a number, so it is not an append target.
void ref.pushState("calls", 1);
// @ts-expect-error the value must be the field's element type.
void ref.pushState("errors", 42);
// @ts-expect-error a field that does not exist on the state is a build error.
void ref.pushState("missing", "x");

// --- The same contract on the context view of a handle ---

void ctx.incState({ tokens: 5 });
void ctx.pushState("errors", "timeout");

// @ts-expect-error `label` holds a string here too.
void ctx.incState({ label: 1 });
// @ts-expect-error and the element type is enforced here too.
void ctx.pushState("errors", 42);
