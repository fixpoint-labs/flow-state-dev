/**
 * The Teammates lab's server, as `fsdev dev --app @flow-state-dev/teammates`
 * loads it from this folder. Everything is read from the environment:
 *
 * - `TEAMMATES_MODEL`: the model Chief of Staff, researcher and writer answer on
 *   (default `openai/gpt-5.4-mini`).
 * - `TEAMMATES_WORKDIR` (required): the working folder, an absolute path to a
 *   git checkout. Coding runs work in worktrees of it, and the workers read
 *   it. Unset, missing, or not a checkout, and the lab fails to start.
 * - `TEAMMATES_STORE`: the SQLite file (default `.fsdev/teammates.sqlite` here).
 * - `TEAMMATES_USER`: who the page acts as (default `you`).
 * - `TEAMMATES_TREE`: the workers' tree (default `workforce/` here).
 * - `TEAMMATES_HARNESS`: the harness coding tasks run on, `claude-code` (the
 *   default) or `codex`.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultStore, openTeammates } from "./host.mts";

const store = process.env.TEAMMATES_STORE ?? defaultStore();
mkdirSync(dirname(store), { recursive: true });

export default await openTeammates({
  store,
  model: process.env.TEAMMATES_MODEL ?? "openai/gpt-5.4-mini",
  userId: process.env.TEAMMATES_USER ?? "you",
  workdir: process.env.TEAMMATES_WORKDIR,
  runsRoot: join(dirname(store), "teammates-runs"),
  ...(process.env.TEAMMATES_TREE === undefined ? {} : { tree: process.env.TEAMMATES_TREE }),
  ...(process.env.TEAMMATES_HARNESS === undefined ? {} : { harness: process.env.TEAMMATES_HARNESS }),
});
