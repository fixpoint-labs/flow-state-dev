/**
 * Shared utility functions for @thought-fabric/core.
 *
 * These are general-purpose helpers used across multiple domains
 * (memory, attention, identity, etc).
 */

/** Generate a short random alphanumeric ID. */
export function shortId(length = 4): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < length; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}
