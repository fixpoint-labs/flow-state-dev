/**
 * In-memory registry of in-flight request streams, keyed by requestId.
 *
 * Streams are registered synchronously before async execution begins,
 * ensuring the SSE endpoint can always find the stream when a client connects.
 */
import type { LiveRequestStream } from "./live-stream";

const activeStreams = new Map<string, LiveRequestStream>();
const streamTouchedAt = new Map<string, number>();

export type ActiveStreamRegistryOptions = {
  maxConcurrentStreams?: number;
  staleStreamTtlMs?: number;
  warnAtRatio?: number;
  now?: () => number;
  onWarning?: (message: string, detail: Record<string, unknown>) => void;
};

const DEFAULT_MAX_CONCURRENT_STREAMS = 1_000;
const DEFAULT_STALE_STREAM_TTL_MS = 5 * 60 * 1000;
const DEFAULT_WARN_AT_RATIO = 0.8;

const activeStreamConfig: Required<
  Omit<ActiveStreamRegistryOptions, "onWarning">
> & {
  onWarning?: ActiveStreamRegistryOptions["onWarning"];
} = {
  maxConcurrentStreams: DEFAULT_MAX_CONCURRENT_STREAMS,
  staleStreamTtlMs: DEFAULT_STALE_STREAM_TTL_MS,
  warnAtRatio: DEFAULT_WARN_AT_RATIO,
  now: () => Date.now(),
  onWarning: undefined
};

export function configureActiveStreamRegistry(
  options: ActiveStreamRegistryOptions
): void {
  activeStreamConfig.maxConcurrentStreams = Math.max(
    1,
    options.maxConcurrentStreams ?? activeStreamConfig.maxConcurrentStreams
  );
  activeStreamConfig.staleStreamTtlMs = Math.max(
    1_000,
    options.staleStreamTtlMs ?? activeStreamConfig.staleStreamTtlMs
  );
  activeStreamConfig.warnAtRatio = Math.min(
    1,
    Math.max(0, options.warnAtRatio ?? activeStreamConfig.warnAtRatio)
  );
  activeStreamConfig.now = options.now ?? activeStreamConfig.now;
  activeStreamConfig.onWarning = options.onWarning ?? activeStreamConfig.onWarning;
}

export function cleanupStaleStreams(): number {
  const now = activeStreamConfig.now();
  let removed = 0;
  for (const [requestId, lastTouchedAt] of streamTouchedAt.entries()) {
    if (now - lastTouchedAt <= activeStreamConfig.staleStreamTtlMs) {
      continue;
    }

    const stream = activeStreams.get(requestId);
    stream?.close();
    activeStreams.delete(requestId);
    streamTouchedAt.delete(requestId);
    removed += 1;
  }

  return removed;
}

export function canRegisterStream(): boolean {
  cleanupStaleStreams();
  return activeStreams.size < activeStreamConfig.maxConcurrentStreams;
}

function maybeWarnCapacity(): void {
  const ratio = activeStreams.size / activeStreamConfig.maxConcurrentStreams;
  if (ratio < activeStreamConfig.warnAtRatio) {
    return;
  }

  activeStreamConfig.onWarning?.("Active stream registry approaching capacity", {
    activeStreams: activeStreams.size,
    maxConcurrentStreams: activeStreamConfig.maxConcurrentStreams,
    usageRatio: ratio
  });
}

/**
 * Registers a live request stream for the given requestId.
 * Must be called synchronously before async execution starts.
 */
export function registerStream(
  requestId: string,
  stream: LiveRequestStream
): void {
  cleanupStaleStreams();
  activeStreams.set(requestId, stream);
  streamTouchedAt.set(requestId, activeStreamConfig.now());
  maybeWarnCapacity();
}

/**
 * Returns the active live stream for a requestId, or undefined if not found
 * (e.g. request already completed and stream was removed).
 */
export function getActiveStream(
  requestId: string
): LiveRequestStream | undefined {
  const stream = activeStreams.get(requestId);
  if (stream !== undefined) {
    streamTouchedAt.set(requestId, activeStreamConfig.now());
  }

  return stream;
}

/**
 * Removes a completed stream from the registry.
 * Called by runAction's finally-block after terminal event + controller close.
 */
export function removeStream(requestId: string): void {
  activeStreams.delete(requestId);
  streamTouchedAt.delete(requestId);
}
