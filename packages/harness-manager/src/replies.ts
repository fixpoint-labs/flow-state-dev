// FIX-2831 D1.
/**
 * How a coding run hands the host its replies to review comments: one file
 * per reply, in a folder its brief names, read when its turn ends and handed
 * to the host's poster (`harnessManager({ replies })`). The run never posts
 * on GitHub itself.
 *
 * The folder is the ask marker's channel (`./ask`): inside the checkout,
 * under `.fsdev/` (which the target repository must ignore, so a draft is
 * never committed), named for the attempt and the run so a stale draft is
 * never read. Each file's first line is the link to the comment it answers;
 * the rest is the reply, as written.
 *
 * **Read as a spec is read, not as the ask marker is.** The run writes this
 * folder, and `readFile` follows a link, so a comment could have the run link
 * a draft to `~/.config/gh/hosts.yml` and the poster would post the token. A
 * draft is read only when it is a regular file whose real path stays under
 * the checkout's `.fsdev/` (as `readIssueSpecSection` reads a spec), opened
 * without following a link, and no longer than {@link REPLY_MAX_BYTES};
 * anything else is refused, and its target is never read.
 */
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { BlockContext, DeclaredResourceEntry } from "@flow-state-dev/core/types";

/** The folder, relative to the checkout, a run's reply folders live in. */
export const REPLY_DIR = join(".fsdev", "replies");

/** The longest reply file read; a longer one is refused whole, never cut. */
export const REPLY_MAX_BYTES = 32 * 1024;

/** The most reply files one run's folder is read for; the rest are refused. */
const MAX_DRAFTS = 50;

/** Where THIS run of attempt `attempt` writes its reply files. */
export function replyFolderPath(workspacePath: string, attempt: number, run: number): string {
  return join(workspacePath, REPLY_DIR, `${attempt}-${run}`);
}

/** One reply a run drafted. */
export interface ReplyDraft {
  /** Its file's name in the run's folder. */
  readonly file: string;
  /** Its first line: the link to the comment it answers. */
  readonly link: string;
  /** The rest, as written, without the blank lines around it. */
  readonly body: string;
}

/** The run's drafts, and the files that were refused and why. */
export interface ReplyDrafts {
  readonly drafts: ReplyDraft[];
  readonly refused: { readonly file: string; readonly reason: string }[];
}

/** Whether `path` is under `root`, both real paths. */
const under = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/**
 * Read this run's reply drafts. A run that wrote none reads as none. A file
 * that is a link, not a regular file, resolves outside the checkout's
 * `.fsdev/`, or is longer than {@link REPLY_MAX_BYTES} is refused unread.
 */
export async function readReplyDrafts(workspacePath: string, attempt: number, run: number): Promise<ReplyDrafts> {
  const folder = replyFolderPath(workspacePath, attempt, run);
  let names: string[];
  try {
    names = (await readdir(folder)).filter((name) => name.endsWith(".md")).sort();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { drafts: [], refused: [] };
    throw err;
  }
  const drafts: ReplyDraft[] = [];
  const refused: { file: string; reason: string }[] = [];
  if (names.length === 0) return { drafts, refused };
  let root: string;
  try {
    root = await realpath(join(workspacePath, ".fsdev"));
  } catch {
    return { drafts, refused: names.map((file) => ({ file, reason: "the checkout's .fsdev folder can't be read" })) };
  }
  for (const [index, file] of names.entries()) {
    if (index >= MAX_DRAFTS) {
      refused.push({ file, reason: `a run's folder is read for ${MAX_DRAFTS} replies at most` });
      continue;
    }
    const path = join(folder, file);
    try {
      if (!(await lstat(path)).isFile()) {
        refused.push({ file, reason: "it is a link or not a regular file, so it was not read" });
        continue;
      }
      // The folder itself may be a link: the file's real path must stay under `.fsdev/`.
      if (!under(root, await realpath(path))) {
        refused.push({ file, reason: "it is reached through a link out of the checkout's .fsdev folder, so it was not read" });
        continue;
      }
      // Opened without following a link: one swapped in since the check is refused by the open itself.
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let text: string;
      try {
        if (!(await handle.stat()).isFile()) {
          refused.push({ file, reason: "it is not a regular file, so it was not read" });
          continue;
        }
        const buffer = Buffer.alloc(REPLY_MAX_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > REPLY_MAX_BYTES) {
          refused.push({ file, reason: `it is longer than ${REPLY_MAX_BYTES / 1024} KB` });
          continue;
        }
        text = buffer.subarray(0, bytesRead).toString("utf8");
      } finally {
        await handle.close();
      }
      const newline = text.indexOf("\n");
      const link = (newline === -1 ? text : text.slice(0, newline)).trim();
      const body = newline === -1 ? "" : text.slice(newline + 1).replace(/^\s*\n/, "").trimEnd();
      drafts.push({ file, link, body });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      refused.push({ file, reason: code === "ELOOP" ? "it is a link, so it was not read" : `it could not be read (${code ?? String(err)})` });
    }
  }
  return { drafts, refused };
}

/**
 * The host's poster for a run's reply drafts (workforce's
 * `operatorGitHub(…).reviewReplies`): it checks each draft and posts it, or
 * says why not. The manager only reads the drafts and hands them over, with
 * the pull requests recorded for the task's run and the task itself.
 */
export interface ReviewReplyPoster {
  /** Check and post each draft; each ends posted (its reply's link) or refused (why). */
  post(
    ctx: BlockContext,
    drafts: readonly ReplyDraft[],
    scope: {
      readonly pullRequests: readonly { readonly repository: string; readonly number: number }[];
      readonly task?: {
        readonly metadata?: Readonly<Record<string, unknown>> | null;
        readonly steers?: readonly { readonly from: string; readonly by?: string; readonly message: string }[] | null;
      };
    },
  ): Promise<readonly { readonly file: string; readonly link: string; readonly posted?: string; readonly refused?: string }[]>;
  /** What `post` reads, declared on the step that runs it. */
  readonly resources?: Readonly<Record<string, DeclaredResourceEntry>>;
}
