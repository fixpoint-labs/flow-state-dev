/**
 * Shared parser for role-tagged Markdown with YAML frontmatter.
 *
 * Splits a `.md` text into frontmatter (via gray-matter) and optional
 * `<system>` / `<user>` / `<context>` role-tagged sections. Used by both
 * the generator prompt-file parser and the resource-template parser — each
 * applies its own validation and render scope on top of this shared split.
 */

import matter from "gray-matter";

const SECTION_TAGS = ["system", "user", "context"] as const;
type SectionTag = (typeof SECTION_TAGS)[number];

export class RoleTaggedMarkdownParseError extends Error {
  readonly sourcePath?: string;
  constructor(message: string, options?: { cause?: unknown; sourcePath?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "RoleTaggedMarkdownParseError";
    this.sourcePath = options?.sourcePath;
  }
}

export interface RoleTaggedMarkdown {
  frontmatter: Record<string, unknown>;
  sections: { system?: string; user?: string; context?: string };
  /** Post-frontmatter body, for templates that use no role tags. */
  body: string;
  raw: string;
}

function extractSection(
  body: string,
  tag: SectionTag,
  sourcePath?: string
): string | undefined {
  const re = new RegExp(`^<${tag}>([\\s\\S]*?)</${tag}>`, "gm");
  const matches = [...body.matchAll(re)];
  if (matches.length > 1) {
    throw new RoleTaggedMarkdownParseError(
      `Multiple <${tag}> blocks found; at most one is allowed.`,
      { sourcePath }
    );
  }
  if (matches.length === 0) return undefined;
  return matches[0]![1]!.replace(/^\n+/, "").replace(/\n+$/, "");
}

/**
 * Split a `.md` text into frontmatter + role-tagged sections.
 *
 * @throws {RoleTaggedMarkdownParseError} on duplicate tags or frontmatter parse failure.
 */
export function parseRoleTaggedMarkdown(
  text: string,
  options?: { sourcePath?: string }
): RoleTaggedMarkdown {
  const sourcePath = options?.sourcePath;

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(text);
  } catch (cause) {
    throw new RoleTaggedMarkdownParseError(
      `Failed to parse frontmatter: ${(cause as Error).message}`,
      { cause, sourcePath }
    );
  }

  const body = parsed.content;
  const system = extractSection(body, "system", sourcePath);
  const user = extractSection(body, "user", sourcePath);
  const context = extractSection(body, "context", sourcePath);

  return {
    frontmatter: (parsed.data as Record<string, unknown>) ?? {},
    sections: { system, user, context },
    body,
    raw: text,
  };
}
