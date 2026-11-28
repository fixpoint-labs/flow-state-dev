// FIX-2831 D2.
/**
 * The GitHub links a user typed, stamped on a task at filing: the pull
 * requests and comments a coding run's review replies may widen to. Only the
 * message that started a turn `isUserTurn` marks counts; a delivered comment,
 * a brief the filer wrote, or a caller's metadata never does (the key is
 * dropped in `callerMetadata`). The poster's reading of those links
 * (`operatorGitHub(…).reviewReplies`) parses them here too.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { isUserTurn, typedMessageOf } from "../standing-rules/user-turn-read";
import { OPERATOR_LINKS } from "./board-entries";

/** The most links one stamp keeps. */
const MAX_LINKS = 50;

/**
 * GitHub's link to a pull request, with an optional comment anchor: the one
 * grammar every link here is found and parsed with.
 */
const PULL_REQUEST_LINK = String.raw`https://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)(?:/files)?(?:#(discussion_r|issuecomment-|pullrequestreview-)(\d+))?`;

/** Every link to a GitHub pull request, or to a comment on one, in `text`, each once, in order. */
function githubPullRequestLinks(text: string): string[] {
  const found = text.match(new RegExp(PULL_REQUEST_LINK, "g")) ?? [];
  return [...new Set(found)].slice(0, MAX_LINKS);
}

/** A pull request link, parsed: `repository` lower-cased, and the comment its anchor names, if any. */
interface GitHubLink {
  readonly repository: string;
  readonly number: number;
  readonly comment?: { readonly surface: CommentSurface; readonly id: number };
}

/** The pull request (and comment) a whole link names, or `undefined`. Only GitHub's own `github.com` links parse. */
function parseGitHubLink(link: string): GitHubLink | undefined {
  const m = new RegExp(`^${PULL_REQUEST_LINK}$`).exec(link.trim());
  if (m === null) return undefined;
  const pr = { repository: m[1]!.toLowerCase(), number: Number(m[2]) };
  if (m[3] === undefined) return pr;
  const surface: CommentSurface = m[3] === "discussion_r" ? "inline" : m[3] === "issuecomment-" ? "conversation" : "review";
  return { ...pr, comment: { surface, id: Number(m[4]) } };
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

/** Where on a pull request the comment a link names sits, by its anchor. */
type CommentSurface = "inline" | "conversation" | "review";

/** A comment link, parsed. */
export interface CommentLink {
  readonly repository: string;
  readonly number: number;
  readonly surface: CommentSurface;
  readonly id: number;
}

/** The comment a link names, or `undefined` for anything else (a pull request's own link included). */
export function parseCommentLink(link: string): CommentLink | undefined {
  const parsed = parseGitHubLink(link);
  return parsed?.comment === undefined ? undefined : { repository: parsed.repository, number: parsed.number, ...parsed.comment };
}

/** `owner/name#n`, lower-cased: how pull requests are compared. */
export const prKey = (repository: string, number: number) => `${repository.toLowerCase()}#${number}`;

/**
 * The pull requests and comments the operator linked to a task: its filing's
 * stamp, and steers the session's user sent. Keys are `owner/name#n` (and
 * `…:surface:id` for a comment), lower-cased.
 */
export function operatorLinked(
  task: { readonly metadata?: Readonly<Record<string, unknown>> | null; readonly steers?: readonly { readonly from: string; readonly by?: string; readonly message: string }[] | null } | undefined,
  user: string
): { prs: Set<string>; comments: Set<string> } {
  const stamped = task?.metadata?.[OPERATOR_LINKS];
  const texts = [
    ...(Array.isArray(stamped) ? stamped.filter((link): link is string => typeof link === "string") : []),
    ...(task?.steers ?? []).filter((steer) => steer.from === "user" && steer.by === user).map((steer) => steer.message)
  ];
  const prs = new Set<string>();
  const comments = new Set<string>();
  for (const link of texts.flatMap(githubPullRequestLinks)) {
    const parsed = parseGitHubLink(link);
    if (parsed === undefined) continue;
    prs.add(prKey(parsed.repository, parsed.number));
    if (parsed.comment !== undefined) comments.add(`${prKey(parsed.repository, parsed.number)}:${parsed.comment.surface}:${parsed.comment.id}`);
  }
  return { prs, comments };
}
