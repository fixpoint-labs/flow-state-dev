/**
 * In-memory registry of in-flight request streams, keyed by requestId.
 *
 * Streams are registered synchronously before async execution begins,
 * ensuring the SSE endpoint can always find the stream when a client connects.
 */
import type { LiveRequestStream } from "./live-stream";

const activeStreams = new Map<string, LiveRequestStream>();

/**
 * Registers a live request stream for the given requestId.
 * Must be called synchronously before async execution starts.
 */
export function registerStream(
  requestId: string,
  stream: LiveRequestStream
): void {
  activeStreams.set(requestId, stream);
}

/**
 * Returns the active live stream for a requestId, or undefined if not found
 * (e.g. request already completed and stream was removed).
 */
export function getActiveStream(
  requestId: string
): LiveRequestStream | undefined {
  return activeStreams.get(requestId);
}

/**
 * Removes a completed stream from the registry.
 * Called by runAction's finally-block after terminal event + controller close.
 */
export function removeStream(requestId: string): void {
  activeStreams.delete(requestId);
}
