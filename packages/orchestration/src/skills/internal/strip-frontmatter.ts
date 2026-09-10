/**
 * Shared frontmatter-stripping helper.
 *
 * Both `run-skill-tool` (fork-mode body resolution) and `worker-materializer`
 * (prompt-ref body resolution) read SKILL.md-shaped files that may carry
 * their own `---`-delimited frontmatter. We treat those bodies as plain
 * Markdown — frontmatter on supporting files is metadata for the parser,
 * not content to render into the system prompt.
 */

import { splitFrontmatter } from "../../shared/frontmatter";

/** Strip a leading `---`-delimited frontmatter block. Idempotent. */
export function stripFrontmatter(text: string): string {
  return splitFrontmatter(text).body;
}
