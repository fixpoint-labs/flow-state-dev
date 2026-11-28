/**
 * Git in a run's checkout that runs none of the checkout's commands.
 *
 * A coding run can write everything its checkout's git reads: `.git/config`,
 * a worktree's `config.worktree`, any file those include, `.gitattributes`,
 * `.git/info/attributes`, and it can do so at any moment, since the run is
 * live while a person reads its changes. Some git commands run a command
 * named there: an fsmonitor hook, an external diff, a diff driver's command
 * or textconv, a clean, smudge or process filter, a signature check's gpg, a
 * lazy fetch's transport. These reads run in the server process.
 *
 * So the rule here depends on no name the run chose:
 *
 * - Only commands that never read a working-tree file's content run in the
 *   checkout ({@link CHECKOUT_READS}): commit and tree reads, listings of the
 *   index and of untracked paths, blob reads. Filters apply only between the
 *   working tree and the object store, so none of these can reach one.
 * - Every diff and log takes `--no-ext-diff --no-textconv`, so no diff driver
 *   runs whatever the attributes name. `cat-file` runs none without
 *   `--filters` or `--textconv`, which are never passed.
 * - The settings that run something on their own (fsmonitor, the pager,
 *   signature checks, every transport) are switched off on the command line
 *   by fixed keys, which outrank every config file. System and global config
 *   aren't read.
 * - The working tree's own content is read by `working-tree.ts` from the
 *   filesystem, and diffed by {@link scratchDiff} in a directory with no
 *   repository, where no config defines any driver.
 *
 * And {@link TRUE_HISTORY}: a run shares its checkout's object store and
 * refs, so it can plant a replace ref, a graft, a commit-graph or a shallow
 * file that rewrites what the base's history looks like. Every read ignores
 * all four.
 */

import { devNull } from "node:os";
import { dirname } from "node:path";
import { run, runBytes } from "@flow-state-dev/workspace";

/** The wall clock for one git read. */
export const GIT_READ_TIMEOUT_MS = 10_000;

/**
 * History as the object store has it: no replace refs, grafts, commit-graph
 * or shallow file. `--shallow-file ""` is how git's own fetch says "no
 * shallow file"; in a checkout whose history really is cut short, a read then
 * fails on the missing parents and answers unverified. No optional locks: a
 * read never refreshes the index, so it never holds the lock a harness's own
 * commit needs.
 */
const TRUE_HISTORY = {
  env: { GIT_NO_REPLACE_OBJECTS: "1", GIT_GRAFT_FILE: devNull, GIT_OPTIONAL_LOCKS: "0" },
  args: ["--shallow-file", "", "-c", "core.commitGraph=false"],
};

/** Every transport git knows by name: a lazy fetch in a partial clone would start one. */
const PROTOCOLS = ["ext", "file", "git", "http", "https", "ssh"];

/** The settings that would run a command on their own, each off by a fixed key; and no system or global config. */
const NO_COMMANDS = {
  env: {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_NO_LAZY_FETCH: "1",
    GIT_PROTOCOL_FROM_USER: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
  },
  args: [
    ["core.fsmonitor", "false"],
    ["core.untrackedCache", "false"],
    ["core.hooksPath", devNull],
    ["core.attributesFile", devNull],
    ["core.pager", "cat"],
    ["diff.external", ""],
    ["log.showSignature", "false"],
    ["protocol.allow", "never"],
    ...PROTOCOLS.map((name) => [`protocol.${name}.allow`, "never"]),
  ].flatMap(([key, value]) => ["-c", `${key}=${value}`]),
};

/** What every diff and log takes, so no diff driver runs whatever the attributes name. */
const NO_DRIVERS = ["--no-ext-diff", "--no-textconv"];

/**
 * The commands a read may run in a run's checkout. None reads a working-tree
 * file's content: a `diff` there always names two commits, and `ls-files`
 * only lists. See {@link checkoutGit}.
 */
const CHECKOUT_READS = new Set(["rev-parse", "merge-base", "rev-list", "log", "diff", "ls-tree", "ls-files", "cat-file"]);

/** `ls-files` modes that compare the working tree's content with the index, which runs the clean filter. */
const LS_FILES_CONTENT = new Set(["-m", "--modified", "-d", "--deleted", "-k", "--killed", "--eol", "--debug"]);

/** Thrown for a read this module doesn't run in a checkout: a command not in {@link CHECKOUT_READS}, or one that would read the working tree's content. */
export class UnsafeCheckoutRead extends Error {
  constructor(args: readonly string[]) {
    super(`[harness-manager] "git ${args.join(" ")}" could read a run's working tree through its filters, so it isn't run.`);
    this.name = "UnsafeCheckoutRead";
  }
}

/** The args for one git command under {@link TRUE_HISTORY} and {@link NO_COMMANDS}; refuses one that could reach a filter. */
function argsOf(args: readonly string[]): string[] {
  const [command, ...rest] = args;
  if (command === undefined || !CHECKOUT_READS.has(command)) throw new UnsafeCheckoutRead(args);
  if (command === "diff" && rest.includes("--no-index")) throw new UnsafeCheckoutRead(args);
  if (command === "ls-files" && rest.some((arg) => LS_FILES_CONTENT.has(arg))) throw new UnsafeCheckoutRead(args);
  if (command === "cat-file" && rest.some((arg) => arg.startsWith("--filters") || arg.startsWith("--textconv") || arg.startsWith("--path"))) {
    throw new UnsafeCheckoutRead(args);
  }
  const flags = command === "diff" || command === "log" ? NO_DRIVERS : [];
  return [...TRUE_HISTORY.args, ...NO_COMMANDS.args, command, ...flags, ...rest];
}

const SAFE_ENV = { ...TRUE_HISTORY.env, ...NO_COMMANDS.env };

/**
 * One git read in a run's checkout `cwd` that runs none of the checkout's
 * commands (see this file's header). With `onLine`, standard output is handed
 * over line by line instead of returned. A diff passed here must name two
 * commits: a diff against the working tree would hash its files through
 * their filters.
 *
 * @throws UnsafeCheckoutRead for a command that could reach a filter.
 */
export async function checkoutGit(cwd: string, args: readonly string[], onLine?: (line: string) => void): Promise<string> {
  const full = argsOf(args);
  return (
    await run("git", full, { cwd, timeoutMs: GIT_READ_TIMEOUT_MS, env: SAFE_ENV, ...(onLine === undefined ? {} : { onLine }) })
  ).stdout;
}

/** {@link checkoutGit}, its standard output as bytes: for blob content, which needn't be text. `input` is written to its standard input. */
export async function checkoutGitBytes(cwd: string, args: readonly string[], input?: string, maxBuffer = 64 * 1024 * 1024): Promise<Buffer> {
  return (await runBytes("git", argsOf(args), { cwd, timeoutMs: GIT_READ_TIMEOUT_MS, env: SAFE_ENV, maxBuffer, input: input ?? "" })).stdout;
}

/**
 * `git diff --no-index` in `root`, a directory this process made and filled,
 * holding no repository: git finds none above it either, and reads no system
 * or global config, so no config defines a filter or driver for any
 * attribute a copied `.gitattributes` names. Exit 1 is "they differ": the
 * answer, not a failure.
 */
export async function scratchDiff(root: string, args: readonly string[], onLine?: (line: string) => void): Promise<string> {
  try {
    return (
      await run("git", [...NO_COMMANDS.args, "diff", "--no-index", ...NO_DRIVERS, "--no-color", "--no-renames", ...args], {
        cwd: root,
        timeoutMs: GIT_READ_TIMEOUT_MS,
        env: { ...NO_COMMANDS.env, GIT_CEILING_DIRECTORIES: dirname(root) },
        ...(onLine === undefined ? {} : { onLine }),
      })
    ).stdout;
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: unknown };
    if (failed.code === 1) return typeof failed.stdout === "string" ? failed.stdout : "";
    throw error;
  }
}
