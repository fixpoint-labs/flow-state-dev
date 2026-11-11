/**
 * The pieces `sessionFeed` is built from, for `@flow-state-dev/react`'s
 * `useSession` and task-board panels, which join their own sources; and the
 * client's abortable `pause`, for the framework's own poll loops. Not a
 * public API: an app follows a session with `sessionFeed`, the one public way,
 * and waits on a request with its handle's `wait()` or `result()`.
 *
 * @internal
 */
export { pause } from "./internal/pause";
export { followSession, type FollowSessionOptions } from "./session-client/follow-session";
export { mayReplaceItem, readSessionHistory, type ReadSessionHistoryOptions } from "./session-client/session-history";
export { liveRead } from "./live/live-read";
export { mayHold, storageRootsOf } from "./live/paths";
