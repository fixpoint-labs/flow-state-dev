/**
 * What a project's `mcpServers` may hold: bare names of MCP servers the host
 * offers, never an address, a variable or a credential.
 *
 * One module, beside `repository-value.ts`, so `createProject` and
 * `setMcpServers` give the same answer. A name becomes the prefix of the
 * relayed tools (`mcp__<name>__<tool>`), so it is lowercase letters, digits
 * and hyphens, starting with a letter or a digit.
 *
 * The answers never repeat a value that failed the shape check: a refused
 * value may be an address or a key. A name that passed it is safe to echo.
 */

import { ProjectRefusedError } from "./project-refusal";

/** A bare server name: lowercase letters, digits and hyphens, at most 64 characters. */
const SERVER_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Whether `value` is a bare MCP server name. */
export function isMcpServerName(value: unknown): value is string {
  return typeof value === "string" && SERVER_NAME.test(value);
}

/**
 * Check a list of server names against the names the host offers, and return
 * it with duplicates dropped, in first-seen order.
 *
 * @param names The list as a caller sent it.
 * @param offered The names the host offers; empty when it offers none.
 * @throws `ProjectRefusedError` `invalid-mcp-server` for a value that is not a
 *   bare name (never repeated), then `unknown-mcp-server` for a name the host
 *   doesn't offer, naming the ones it does.
 */
export function checkedMcpServers(names: readonly unknown[], offered: readonly string[]): string[] {
  if (!names.every(isMcpServerName)) {
    throw new ProjectRefusedError(
      "invalid-mcp-server",
      'an MCP server is named by a bare name: lowercase letters, digits and hyphens, such as "linear". ' +
        "An address, a variable or a key can't be a project's server."
    );
  }
  const unique = [...new Set(names)];
  const unknown = unique.filter((name) => !offered.includes(name));
  if (unknown.length > 0) {
    const offers =
      offered.length === 0 ? "this host offers no MCP servers" : `it offers ${offered.map((name) => `"${name}"`).join(", ")}`;
    throw new ProjectRefusedError(
      "unknown-mcp-server",
      `${unknown.map((name) => `"${name}"`).join(", ")} ${unknown.length === 1 ? "is" : "are"} not an MCP server this host offers: ${offers}.`
    );
  }
  return unique;
}
