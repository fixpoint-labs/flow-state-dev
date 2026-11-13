/**
 * How the closure serves the Teammates lab for one run: its folder, its
 * config, and the env it is served with. Kept apart from `run.mts`, which
 * runs the closure when imported, so the graders can read what each pass
 * serves without serving it.
 */
import { join } from "node:path";
import type { ClosurePass, serveFsdev } from "../closure.mts";
import type { Draw } from "../fixtures.mts";

/** The user every ask is made as. */
export const USER = "u_closure";
/** The lab's folder in the tree at `root`. */
const lab = (root: string) => join(root, "labs", "teammates");
/** The lab's workforce tree in the tree at `root`. */
export const tree = (root: string) => join(lab(root), "workforce");
/** The run's fresh SQLite store under `scratch`. */
export const storeFile = (scratch: string) => join(scratch, "teammates.sqlite");

/** `serveFsdev`'s options for one run: a fresh store under `scratch`, `workdir` as the working folder. */
export function teammatesServe(d: Draw, p: ClosurePass, scratch: string, workdir: string): Parameters<typeof serveFsdev>[0] {
  return {
    root: p.root,
    cwd: lab(p.root),
    // Named, not found in the folder: on Haiku it is the config `haiku.config.mts` loads.
    args: ["--config", join(lab(p.root), "fsdev.config.mts")],
    model: p.model,
    logTo: join(scratch, "server.log"),
    env: {
      TEAMMATES_STORE: storeFile(scratch),
      TEAMMATES_USER: USER,
      TEAMMATES_WORKDIR: workdir,
      TEAMMATES_HARNESS: "claude-code",
      // The working folder's checks are its data, like a project's in the other apps: a fixture, not a switch.
      TEAMMATES_CHECKS: d.coder.check,
    },
  };
}
