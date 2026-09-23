/**
 * The navigator's published props are an allow-list, and this is the half of
 * it that no test can be written around (FIX-1477 BR-3, BR-24, V5).
 *
 * A denylist naming `depth`, `levels` and `orgId` would pass the fourth
 * spelling of the same idea. This asserts the two sets are equal, so a new prop
 * fails here whether or not whoever added it thought about the rule, and
 * `flowNavigatorPropNames` cannot drift from the type it stands for.
 *
 * Typecheck is the run: `pnpm --filter @flow-state-dev/react typecheck`.
 */
import {
  flowNavigatorPropNames,
  type FlowNavigatorProps
} from "./FlowNavigator";

type Published = (typeof flowNavigatorPropNames)[number];

/** Compiles only for `never`; the error names the offending key. */
type NoneOf<T extends never> = T;

/** A prop exists that the published list does not name. */
export type UnlistedProp = NoneOf<Exclude<keyof FlowNavigatorProps, Published>>;

/** The published list names something that is not a prop. */
export type PhantomProp = NoneOf<Exclude<Published, keyof FlowNavigatorProps>>;
