/**
 * Each user's own keys for the MCP servers a host offers.
 *
 *   mcp-credentials/<server>    at user scope: one record per server the user set a key for
 *
 * A record is `{ value, setAt }`. Its existence is what "set" means; `setAt`
 * is when. The value is the key as the user wrote it, unencrypted, in the
 * host's store: anyone who can read that store can read it.
 *
 * **Write-only from outside.** A browser read of the collection exposes
 * `setAt` alone (BP-015), so no client field, page or response carries a value.
 * The value is also declared `secret`, which keeps it out of the engine's
 * debug reads, the one path that ignores `expose`.
 * The writes go around the action pipeline, since an action's input is kept
 * on its request record: a host writes a record through its own route
 * ({@link mcpCredentialProblem} checks the value), and the one reader of the
 * value is the relay that connects a run's servers (`projectMcpTools`), on
 * the server.
 *
 * Not installed on any generator: only the block a coding run asks its tools
 * from holds it ({@link mcpCredentialsCapability}).
 *
 * This key prefix is a public surface: moving it loses every stored key.
 */

import { defineCapability, defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

/** The resource-map ref the keys are declared under. */
export const MCP_CREDENTIALS_RESOURCE = "mcpCredentials";

/** The keys' storage prefix, at user scope: a record's key is `mcp-credentials/<server>`. */
export const MCP_CREDENTIALS_PREFIX = "mcp-credentials/";

/** One stored key: the value as written, and when it was set (ISO 8601). */
export const mcpCredentialSchema = z.object({
  value: z.string(),
  setAt: z.string()
});

/** @see mcpCredentialSchema */
export type McpCredential = z.infer<typeof mcpCredentialSchema>;

const MCP_CREDENTIALS_COLLECTION = defineResourceCollection({
  pattern: "mcp-credentials/*",
  scope: "user",
  // Shared across flows: the host's write and the run's read are on different flows.
  flowIsolation: false,
  prefetchMode: "lazy",
  stateSchema: mcpCredentialSchema,
  // The key never leaves the server, debug reads included; a run reads it through the handle.
  secret: ["value"],
  client: { state: { read: true }, expose: ["setAt"] }
});

/**
 * The keys collection, at `mcp-credentials/*` in each user's own scope. The
 * same declaration every call returns, so two blocks that hold it meet in one
 * flow without a conflict.
 */
export function defineMcpCredentialsCollection() {
  return MCP_CREDENTIALS_COLLECTION;
}

/** The keys collection, for the block a coding run's tools are resolved on. */
export const mcpCredentialsCapability = defineCapability({
  name: "mcp-credentials",
  resources: { [MCP_CREDENTIALS_RESOURCE]: MCP_CREDENTIALS_COLLECTION }
});

/** The longest key a record takes. */
const MAX_CREDENTIAL_LENGTH = 4096;

/**
 * Why `value` can't be stored as a key, or `undefined` when it can. Empty,
 * too long, or holding whitespace or a control character. Never repeats the
 * value.
 */
export function mcpCredentialProblem(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return "a key can't be empty. Clear it instead";
  if (value.length > MAX_CREDENTIAL_LENGTH) return `a key is at most ${MAX_CREDENTIAL_LENGTH} characters`;
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return "a key can't contain whitespace or control characters";
  return undefined;
}
