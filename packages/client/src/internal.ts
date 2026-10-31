/**
 * The pieces `sessionFeed` is built from, for `@flow-state-dev/react`'s
 * `useSession` and task-board panels, which join their own sources. Not a
 * public API: an app follows a session with `sessionFeed`, the one public way.
 *
 * @internal
 */
export { followSession, type FollowSessionOptions } from "./session-client/follow-session";
export { mayReplaceItem, readSessionHistory, type ReadSessionHistoryOptions } from "./session-client/session-history";
