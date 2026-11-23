// FIX-2789; FIX-2873.
/**
 * The trusted GitHub reviewers' document: its ref, how its body lists
 * accounts, and the body a default or a save stores. The screen reads it
 * with {@link githubLoginsListed}, and the tool writes it with
 * {@link githubReviewersDocument}, so the two can't disagree.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { githubLoginId } from "./normalize";

/** The document's ref and accessor: the org's one list. **Pinned**: a saved list reads under it. */
export const GITHUB_REVIEWERS_DOC = "github-reviewers";

/** Whether a listed account is a bot (`name[bot]`). */
export const isListedBot = (login: string) => /\[bot\]$/.test(login);

/**
 * The accounts a document lists, one to a Markdown list item (`- octocat`,
 * `* @octocat`, `- cursor[bot]`), each lower-cased, a bot keeping its
 * `[bot]`. Every other line, prose and headings included, names nobody.
 */
export function githubLoginsListed(document: string | null | undefined): string[] {
  const logins: string[] = [];
  for (const line of (document ?? "").split("\n")) {
    const listed = /^\s*[-*]\s+@?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(\[bot\])?\s*$/i.exec(line);
    if (listed !== null) logins.push(`${githubLoginId(listed[1]!)}${listed[2] === undefined ? "" : "[bot]"}`);
  }
  return logins;
}

/**
 * The line only the default's body carries: a save writes the body without it, so the tool can
 * tell a list nobody has saved from a saved one that reads the same. A stored row never carries it.
 */
const UNSAVED_LINE = "Nobody has saved this list yet: it is the `GITHUB_REVIEWERS` default.";

/**
 * The `github-reviewers` document's body for `logins`: what a save stores, and, with
 * `{ unsaved: true }`, the default that stands until the first save.
 */
export function githubReviewersDocument(logins: readonly string[], options: { readonly unsaved?: true } = {}): string {
  return [
    "# Trusted GitHub reviewers",
    "",
    "A review or comment on a coding run's pull request reaches the run only from an account listed here: a bot, listed as `name[bot]`, or a user who can also write to the repository.",
    "",
    ...(options.unsaved === true ? [UNSAVED_LINE, ""] : []),
    ...logins.map((login) => `- ${login}`),
    ""
  ].join("\n");
}

/** The document as the running block declares it, or a throw naming it when it doesn't. */
export function reviewersDocumentOf(ctx: BlockContext) {
  const ref = (ctx.resources as Record<string, { readContent?: () => Promise<string | null>; writeContent?: (content: string) => Promise<void> }> | undefined)?.[
    GITHUB_REVIEWERS_DOC
  ];
  if (typeof ref?.readContent !== "function") throw new Error(`the "${GITHUB_REVIEWERS_DOC}" document isn't installed`);
  const doc = ref as { readContent: () => Promise<string | null>; writeContent?: (content: string) => Promise<void> };
  return {
    /** The stored row whenever one exists, an emptied list included; the definition content only with none. */
    read: async () => githubLoginsListed(await doc.readContent()),
    /** Whether the operator has saved the list: a stored row, never the default, whatever it lists. */
    saved: async () => {
      const content = await doc.readContent();
      return content !== null && !content.split("\n").includes(UNSAVED_LINE);
    },
    write: (logins: readonly string[]) => {
      if (typeof doc.writeContent !== "function") throw new Error(`the "${GITHUB_REVIEWERS_DOC}" document can't be written here`);
      return doc.writeContent(githubReviewersDocument(logins));
    }
  };
}
