// FIX-2624.
/**
 * The names usage is reached by: its collection, the flow that writes it, and
 * that flow's view and Re-check. Import-free, so a browser bundle can name them.
 */

/** Accessor key and storage prefix for the usage record. */
export const HARNESS_USAGE = "harness-usage" as const;

/** The collection's pattern, which a client addresses it by. */
export const HARNESS_USAGE_PATTERN = `${HARNESS_USAGE}/**` as const;

/**
 * The flow a host installs to serve usage (`harnessUsageFlow`), and the
 * collection's `runBy`: a client's Re-check runs here.
 */
export const HARNESS_USAGE_FLOW = "harness-usage" as const;

/** The usage view on {@link HARNESS_USAGE_FLOW}: the stored rows, with their ages. */
export const HARNESS_USAGE_VIEW = "usage" as const;

/** The Re-check action on {@link HARNESS_USAGE_FLOW}: ask each harness, at most once a minute. */
export const HARNESS_USAGE_RECHECK = "recheck" as const;
