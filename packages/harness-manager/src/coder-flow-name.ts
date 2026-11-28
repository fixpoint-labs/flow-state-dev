/**
 * The coding worker flow's name, in a leaf module so a page (through
 * `./browser`) and the harness kit spell it once: a coding worker's
 * `WORKER.md` names it in its `flow:` line.
 */
export const CODER_FLOW = "coder";

/**
 * The coding worker flow's action that reads a run session's recorded pull
 * requests again from GitHub and writes each one's state back
 * (`refreshSessionPullRequests` sends it from a page).
 */
export const REFRESH_PULL_REQUESTS = "refreshPullRequests";
