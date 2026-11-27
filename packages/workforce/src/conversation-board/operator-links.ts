// FIX-2831 D2.
/**
 * The GitHub links a user typed, stamped on a task at filing: the pull
 * requests and comments a coding run's review replies may widen to. Only the
 * message that started a turn `isUserTurn` marks counts; a delivered comment,
 * a brief the filer wrote, or a caller's metadata never does (the key is
 * dropped in `callerMetadata`).
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { isUserTurn, typedMessageOf } from "../standing-rules/user-turn";
import { OPERATOR_LINKS } from "./board-entries";

/** The most links one stamp keeps. */
const MAX_LINKS = 50;

/** Every link to a GitHub pull request, or to a comment on one, in `text`, each once, in order. */
export function githubPullRequestLinks(text: string): string[] {
  const found = text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+[\w/#-]*/g) ?? [];
  return [...new Set(found)].slice(0, MAX_LINKS);
}

/**
 * The stamp a task filed now carries: `{ [OPERATOR_LINKS]: links }` when this
 * turn is one the user's typed message started and that message links a pull
 * request or a comment; otherwise nothing.
 */
export function operatorLinksStamp(ctx: BlockContext): Record<string, string[]> {
  if (!isUserTurn(ctx)) return {};
  const links = githubPullRequestLinks(typedMessageOf(ctx) ?? "");
  return links.length === 0 ? {} : { [OPERATOR_LINKS]: links };
}
