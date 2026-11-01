/**
 * `fsdev worktrees` — see and remove the git worktrees a workspace host made
 * for coding runs, from a terminal.
 *
 * Built on `@flow-state-dev/workspace`'s host: the listing is `list`, and
 * removal is `remove`, the one removal path, so a terminal refuses exactly
 * what a session's Worktree menu refuses (uncommitted work, a worktree a run
 * is working in, a place being provisioned, a branch holding the only copy of
 * a commit unless forced).
 *
 * The host's root is the argument. The repositories asked are each clone
 * under the root, each repository a host on this root listed (from the fetch
 * pins it kept there), and any `--repo`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { localWorkspaceHost, WorkspaceRefusedError, type ListedWorktree } from "@flow-state-dev/workspace";
import { EXIT_EXECUTION_ERROR, EXIT_INVALID_ARGS, EXIT_SUCCESS } from "../exit-codes";

/** Where a host keeps the fetch pins of each repository it listed. */
const FETCH_PINS_DIR = ".fetch-pins";

/** Options for {@link executeWorktreesCommand}. */
export interface WorktreesCommandOptions {
  /** Repositories on this machine to ask, beside those the root's pins name. */
  repo?: string[];
  /** Remove the worktree at this directory instead of listing. */
  remove?: string;
  /** With `remove`, delete its branch too. */
  deleteBranch?: boolean;
  /** With `deleteBranch`, delete a branch holding the only copy of a commit. */
  force?: boolean;
  /** Print the listing as JSON. */
  json?: boolean;
}

/** The repositories hosts on `root` listed, as their pin files name them. */
function pinnedRepositories(root: string): string[] {
  const dir = join(root, FETCH_PINS_DIR);
  if (!existsSync(dir)) return [];
  const repos: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const repo = (JSON.parse(readFileSync(join(dir, name), "utf8")) as { repo?: unknown }).repo;
      if (typeof repo === "string" && existsSync(repo)) repos.push(repo);
    } catch {
      // A pin file that can't be read names no repository.
    }
  }
  return repos;
}

/** One line per worktree: dirty mark, branch, directory. */
function formatWorktrees(listed: readonly ListedWorktree[]): string {
  if (listed.length === 0) return "No worktrees.";
  return listed
    .map((entry) => {
      const mark = entry.dirty === null ? "gone " : entry.dirty ? "dirty" : "clean";
      return `${mark}  ${entry.branch ?? "(detached)"}  ${entry.cwd}`;
    })
    .join("\n");
}

/** Run the command. Returns the exit code. */
export async function executeWorktreesCommand(rootArg: string, options: WorktreesCommandOptions): Promise<number> {
  const root = resolve(rootArg);
  if (!existsSync(root)) {
    console.error(`${root} does not exist.`);
    return EXIT_INVALID_ARGS;
  }
  const host = localWorkspaceHost({
    root,
    remotes: { allow: [] },
    localRepositories: [...new Set([...pinnedRepositories(root), ...(options.repo ?? []).map((path) => resolve(path))])],
    source: () => ({ kind: "refused", reason: "listing-only", message: "fsdev worktrees provisions nothing." }),
  });
  try {
    if (options.remove !== undefined) {
      const removed = await host.remove!(
        { cwd: options.remove },
        { deleteBranch: options.deleteBranch === true, force: options.force === true },
      );
      console.log(
        `Removed ${removed.cwd}` +
          (removed.branch === null ? "." : removed.branchDeleted ? ` and deleted branch ${removed.branch}.` : `; branch ${removed.branch} kept.`),
      );
      return EXIT_SUCCESS;
    }
    const listed = await host.list!();
    console.log(options.json === true ? JSON.stringify(listed, null, 2) : formatWorktrees(listed));
    return EXIT_SUCCESS;
  } catch (error) {
    console.error(error instanceof WorkspaceRefusedError ? `Refused (${error.reason}): ${error.message}` : String((error as Error).message ?? error));
    return EXIT_EXECUTION_ERROR;
  }
}

/** Register `fsdev worktrees`. */
export function registerWorktreesCommand(program: Command): void {
  program
    .command("worktrees")
    .description("List the worktrees a workspace host made for coding runs, or remove one")
    .argument("<root>", "The workspace host's root directory")
    .option("--repo <path...>", "Repositories on this machine to ask, beside those the root's pins name")
    .option("--remove <dir>", "Remove the worktree at this directory")
    .option("--delete-branch", "With --remove, delete its branch too")
    .option("--force", "With --delete-branch, delete a branch holding the only copy of a commit")
    .option("--json", "Print the listing as JSON")
    .action(async (root: string, options: WorktreesCommandOptions) => {
      process.exitCode = await executeWorktreesCommand(root, options);
    });
}
