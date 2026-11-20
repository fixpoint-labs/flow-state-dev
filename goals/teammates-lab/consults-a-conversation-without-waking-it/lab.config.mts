/**
 * The lab legs 1 and 2 serve: the Teammates lab's own host
 * (`labs/teammates/host.mts`) on the goal's copy of its workers, as its
 * `fsdev.config.mts` builds it, with each request taken as the user it is
 * signed in as (`signedInUser`), so two users can share it. The lab itself
 * takes every request as its own user. `fsdev dev --config` serves it.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { openTeammates } from "../../../labs/teammates/host.mts";
import { signedInUser } from "../lab.mts";

const need = (key: string) => {
  const value = process.env[key];
  if (value === undefined || value === "") throw new Error(`consults lab: ${key} is unset`);
  return value;
};

const store = need("TEAMMATES_STORE");
mkdirSync(dirname(store), { recursive: true });

export default await openTeammates({
  store,
  model: process.env.TEAMMATES_MODEL ?? "openai/gpt-6-luna",
  userId: need("TEAMMATES_USER"),
  user: signedInUser,
  workdir: need("TEAMMATES_WORKDIR"),
  runsRoot: join(dirname(store), "teammates-runs"),
  tree: need("TEAMMATES_TREE"),
});
