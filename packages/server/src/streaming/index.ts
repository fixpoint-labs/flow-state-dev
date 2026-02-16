/**
 * Public streaming runtime API surface for event ids, emitters, replay, and SSE serialization.
 */
export {
  createRequestEventId,
  createStreamEventId,
  createUserEventId,
  encodeStreamEvent
} from "./encode-event";

export {
  createResponseEmitter,
  ResponseEmitter
} from "./response-emitter";
export type {
  CreateResponseEmitterOptions,
  RequestStreamEventWithId
} from "./response-emitter";

export {
  parseStartingAfter,
  parseStreamEventId,
  replayRequestEvents,
  resolveRequestReplayCursor
} from "./resume";
export type {
  ParsedStreamEventId,
  ReplayRequestEventsOptions,
  RequestReplayCursor,
  ResolveRequestReplayCursorOptions,
  ResumeCursorSource
} from "./resume";

export {
  serializeSSEFrame,
  serializeSSEFrames
} from "./sse";
export type { SSEFrame } from "./sse";
