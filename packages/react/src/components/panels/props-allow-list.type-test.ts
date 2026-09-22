/**
 * Both panels' published props are an allow-list, and this is the half of it
 * no runtime test can be written around (FIX-1477 BR-24, V5).
 *
 * A denylist naming `orgId` would pass the second spelling of the same idea —
 * `organizationId`, `tenant`, `filterBy`. This asserts that the published name
 * list and the prop type are the same set, so a new prop fails here whether or
 * not whoever added it thought about the rule, and the `*PropNames` arrays
 * cannot drift from the types they stand for.
 *
 * The rule they encode: neither component takes a filter for the organization.
 * The collections are organization-scoped at the store, so the read already
 * resolves against the session's own organization; a prop would be a second
 * opinion about a boundary the server holds, and one that silently did nothing
 * would be worse than none.
 *
 * Typecheck is the run: `pnpm --filter @flow-state-dev/react typecheck`.
 */
import { rosterPropNames, type RosterProps } from "./Roster";
import { boardColumnsPropNames, type BoardColumnsProps } from "./BoardColumns";

type PublishedRoster = (typeof rosterPropNames)[number];
type PublishedBoard = (typeof boardColumnsPropNames)[number];

/** Compiles only for `never`; the error names the offending key. */
type NoneOf<T extends never> = T;

/** A prop exists that the published list does not name. */
export type UnlistedRosterProp = NoneOf<Exclude<keyof RosterProps, PublishedRoster>>;
export type UnlistedBoardProp = NoneOf<Exclude<keyof BoardColumnsProps, PublishedBoard>>;

/** The published list names something that is not a prop. */
export type PhantomRosterProp = NoneOf<Exclude<PublishedRoster, keyof RosterProps>>;
export type PhantomBoardProp = NoneOf<Exclude<PublishedBoard, keyof BoardColumnsProps>>;
