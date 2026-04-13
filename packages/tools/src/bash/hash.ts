/**
 * Content hashing utility for file diff detection during flush.
 *
 * Uses Node's built-in crypto to produce a fast hex digest for comparing
 * file contents between the sandbox and resource state.
 */

import { createHash } from "node:crypto";

/** Returns a hex SHA-256 hash of the given string content. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
