/**
 * How every watch in the app reads: the stop it hands back, how often a read
 * with no stream reads again, the notices it hears, the requests that are not
 * a worker answering, and what it does with a failed read.
 */
import type { WireNotice } from "@flow-state-dev/client";

/** Stops a watch. */
export type Unsubscribe = () => void;

/** How often the reads with no stream are read again. */
export const POLL_MS = 1_500;

/** Requests that are a worker answering: everything but the board's own passes. */
export const QUIET_ACTIONS = new Set(["dispatch"]);

/** A live read's failure, logged; the read tries again on its own (`client.live`). */
export const logFailedRead = (error: unknown): void => console.error("teammates: a read failed", error);

/** A request notice: one of the session's requests was created, moved or deleted. Never `items`, sent per stored chunk. */
export const isRequest = (notice: WireNotice): boolean => notice.kind === "request";
