/**
 * Shared frontmatter-stripping helper.
 *
 * `render-skill-body` (and any other SKILL.md-shaped reader) strips a leading
 * `---`-delimited frontmatter block so the body is plain Markdown. Agent
 * prompt files use `parseAgentPromptFile` instead — they keep the frontmatter
 * as generator config, not discarded metadata.
 */

import { splitFrontmatter } from "../../shared/frontmatter";

/** Strip a leading `---`-delimited frontmatter block. Idempotent. */
export function stripFrontmatter(text: string): string {
  return splitFrontmatter(text).body;
}
