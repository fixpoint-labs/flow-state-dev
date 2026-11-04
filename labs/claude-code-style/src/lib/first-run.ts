/**
 * The words a first run reads: what each view does, example lines to start a
 * session with, and what happens to a repository the lab works in. Copy only;
 * no file, worker or project is named that the lab didn't read when it drew.
 */
import type { ModeId } from "../modes";

/** What *New session* says about the view it opens in, above the projects. */
export const PICKER_COPY: Record<ModeId, string> = {
  session:
    "A session is one conversation with the main worker. It works in the project's checkout itself and hands long pieces to background tasks, listed on the right.",
  threads:
    "A Projects session is with a lead. It files each piece of work as a thread on the board to the right, and a thread's changes wait for your review before they count.",
};

/** Lines an empty session offers; a click puts one in the composer, and nothing is sent. */
export const STARTER_LINES: Record<ModeId, readonly string[]> = {
  session: [
    "Explain how this repository is organized",
    "Find one failing or missing test and fix it",
    "Add a short usage example to the docs",
  ],
  threads: [
    "Split this into threads: tidy the docs, and add a test for the main entry point",
    "File a thread to review error handling and propose fixes",
    "Look for dead code and file a thread per module worth cleaning up",
  ],
};

/** What the empty right pane says will appear there, by the view's pane. */
export const EMPTY_PANE: Record<"tasks" | "board", string> = {
  tasks: "Background tasks the main worker starts show here, with their progress. Open one to steer, stop or retry it.",
  board: "Threads the lead files show here as a board. Open one to follow its work and review its changes.",
};

/** What happens to a repository the host can use: where a run's checkout goes. */
export function repositoryDisclosure(how: "worktree" | "clone"): string {
  return how === "worktree"
    ? "Coding runs work in their own git worktrees of this repository, each on its own branch. Your checkout and the branch it is on are never changed."
    : "Coding runs work in a clone of this repository under the lab's data folder, each on its own branch. The repository itself is only read.";
}
