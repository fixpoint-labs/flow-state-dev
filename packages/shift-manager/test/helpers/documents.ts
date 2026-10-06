/**
 * The oracle side of Jump to's document rule, for tests: a declared document
 * a browser may read is one whose frontmatter sets
 * `client: { content: { read: true } }`, the same flag the Lab's manifest
 * publishes as `client.content.read` and Shift Manager's reads list by.
 */
import type { ResourceDoc } from "@flow-state-dev/workforce";

/** Whether a tree's declared document lets a browser read its content. */
export function declaredBrowserReadable(doc: ResourceDoc): boolean {
  return (doc.declared.client as { content?: { read?: unknown } } | undefined)?.content?.read === true;
}
