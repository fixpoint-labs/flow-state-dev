/**
 * The panels' published props are an allow-list, and this is the half of it
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
import { boardListPropNames, type BoardListProps } from "./BoardList";

type PublishedRoster = (typeof rosterPropNames)[number];
type PublishedBoard = (typeof boardColumnsPropNames)[number];
type PublishedList = (typeof boardListPropNames)[number];

/** Every key of every member, since `BoardListProps` is a union over its transport. */
type KeysOf<T> = T extends unknown ? keyof T : never;

/** Compiles only for `never`; the error names the offending key. */
type NoneOf<T extends never> = T;

/** A prop exists that the published list does not name. */
export type UnlistedRosterProp = NoneOf<Exclude<keyof RosterProps, PublishedRoster>>;
export type UnlistedBoardProp = NoneOf<Exclude<keyof BoardColumnsProps, PublishedBoard>>;
export type UnlistedListProp = NoneOf<Exclude<KeysOf<BoardListProps>, PublishedList>>;

/** The published list names something that is not a prop. */
export type PhantomRosterProp = NoneOf<Exclude<PublishedRoster, keyof RosterProps>>;
export type PhantomBoardProp = NoneOf<Exclude<PublishedBoard, keyof BoardColumnsProps>>;
export type PhantomListProp = NoneOf<Exclude<PublishedList, KeysOf<BoardListProps>>>;

/**
 * A live list that reads through the host's own client names the transport
 * its stream is sent with (FIX-1622 BR-16). Without it the stream would go out
 * without the read's credential, be refused, and leave the list reading once
 * with nothing on screen to say so; so that shape does not compile.
 */
type Assignable<T, U> = [T] extends [U] ? true : false;
type IsTrue<T extends true> = T;
type IsFalse<T extends false> = T;
type Where = { sessionId: string; boardRef: string };
type HostClient = NonNullable<BoardColumnsProps["resourceClient"]>;
type HostFetch = NonNullable<BoardListProps["fetcher"]>;

export type LiveWithHostTransport = IsTrue<
  Assignable<Where & { resourceClient: HostClient; fetcher: HostFetch; live: boolean }, BoardListProps>
>;
export type ReadOnceWithHostClient = IsTrue<Assignable<Where & { resourceClient: HostClient }, BoardListProps>>;
export type LiveOnTheProvider = IsTrue<Assignable<Where & { live: true }, BoardListProps>>;
/**
 * A host client that reads another origin names that origin too, so the
 * stream follows the session on the same server; and a client read without
 * `live` takes no origin it would never use.
 */
export type LiveWithHostTransportElsewhere = IsTrue<
  Assignable<Where & { resourceClient: HostClient; fetcher: HostFetch; baseUrl: string; live: boolean }, BoardListProps>
>;
export type LiveOnAnotherOrigin = IsTrue<Assignable<Where & { baseUrl: string; live: true }, BoardListProps>>;
export type OriginWithoutLive = IsFalse<Assignable<Where & { resourceClient: HostClient; baseUrl: string }, BoardListProps>>;
export type LiveWithoutTransport = IsFalse<Assignable<Where & { resourceClient: HostClient; live: true }, BoardListProps>>;
export type MaybeLiveWithoutTransport = IsFalse<
  Assignable<Where & { resourceClient: HostClient; live: boolean }, BoardListProps>
>;
