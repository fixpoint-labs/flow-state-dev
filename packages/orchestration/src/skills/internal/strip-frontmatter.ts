/**
 * Shared frontmatter-stripping helper.
 *
 * Both `run-skill-tool` (fork-mode body resolution) and `worker-materializer`
 * (prompt-ref body resolution) read SKILL.md-shaped files that may carry
 * their own `---`-delimited frontmatter. We treat those bodies as plain
 * Markdown — frontmatter on supporting files is metadata for the parser,
 * not content to render into the system prompt.
 */

/** Strip a leading `---`-delimited frontmatter block. Idempotent. */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text;
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return text;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      return lines.slice(i + 1).join("\n").replace(/^\r?\n/, "");
    }
  }
  return text;
}
