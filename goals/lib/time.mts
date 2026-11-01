/** Waiting in goal scripts. */

/** Resolves after `ms` milliseconds. */
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
