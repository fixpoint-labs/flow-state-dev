/**
 * The Teammates lab's server, as `fsdev dev --app @flow-state-dev/teammates`
 * loads it from this folder. Everything is read from the environment:
 *
 * - `TEAMMATES_MODEL`: the model lead, researcher and writer answer on
 *   (default `openai/gpt-5.4-mini`).
 * - `TEAMMATES_PROJECTS`: a JSON list of projects to create at start, each
 *   `{ "id", "title", "checkout"? }`. A project with a `checkout` (an absolute
 *   path to a git checkout) has its coding runs work in a worktree of it.
 * - `TEAMMATES_STORE`: the SQLite file (default `.fsdev/teammates.sqlite` here).
 * - `TEAMMATES_USER`: who the page acts as (default `you`).
 * - `TEAMMATES_TREE`: the workers' tree (default `workforce/` here).
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultStore, openTeammates, type LabProject } from "./host.mts";

const store = process.env.TEAMMATES_STORE ?? defaultStore();
mkdirSync(dirname(store), { recursive: true });

export default await openTeammates({
  store,
  model: process.env.TEAMMATES_MODEL ?? "openai/gpt-5.4-mini",
  userId: process.env.TEAMMATES_USER ?? "you",
  projects: JSON.parse(process.env.TEAMMATES_PROJECTS ?? "[]") as LabProject[],
  runsRoot: join(dirname(store), "teammates-runs"),
  ...(process.env.TEAMMATES_TREE === undefined ? {} : { tree: process.env.TEAMMATES_TREE }),
});
