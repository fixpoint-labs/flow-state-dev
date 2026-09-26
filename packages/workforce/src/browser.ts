/**
 * `@flow-state-dev/workforce/browser` — the names a browser component needs
 * from this package, and nothing that runs a seat.
 *
 * The package root is not safe to bundle for a browser: the channel floor
 * reaches the orchestration task board, which imports `node:async_hooks`. A
 * bundler that drops unused re-exports hides that until a client component
 * asks for one name that sits beside the runtime, and then the page fails to
 * compile. Import from here in a client component instead.
 *
 * `test/browser-subpath-safe.test.ts` walks this entry's import graph, through
 * the workspace packages it reaches, and fails on any Node built-in.
 */

export { HIRED_ROSTER_RESOURCE, SEAT_INVENTORY_RESOURCE } from "./seat-hire-keys";
export { splitSeatAddress } from "./roster/address";
export {
  CHANNEL_POST_COMPONENT,
  channelTranscriptLineSchema,
  type ChannelTranscriptLine
} from "./channel/channel-post-line";
