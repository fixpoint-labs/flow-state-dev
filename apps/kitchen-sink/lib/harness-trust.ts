/**
 * The trust a harness run on this server is built with, and the line each
 * session's header shows about what the run loads from the repository.
 *
 * Server only. Trust comes from the server's environment through
 * `readHarnessTrust` (`lib/harness-workspace.ts`), the workspace setting's own
 * reader, and from nowhere else: no request, session input or session state
 * reaches it. Each mode turns it into its harness's options; the line is
 * worked out from those options, so it says what the run was handed, not what
 * the setting says.
 *
 * The goal control `untrusted` (test-mode builds only) reads the server as
 * untrusted whatever its settings say, so a goal check that a trusted session
 * follows the repository can be seen to fail.
 */
import { goalControl } from "./goal-control";
import { readHarnessTrust, type HarnessTrust } from "./harness-workspace";

/** The server's trust, as every harness mode builds its run from it. */
export function harnessTrust(): HarnessTrust {
  if (goalControl() === "untrusted") return { trusted: false, pass: [] };
  const { trusted, pass } = readHarnessTrust();
  return { trusted, pass };
}

/**
 * What a session's header says about the repository: what its harness loads
 * from it, and the names of the keys the operator had passed to the run.
 */
export interface RepoLine {
  /** After "Repo conventions:", e.g. "loaded, hooks off" or "not loaded". */
  readonly conventions: string;
  /** The operator's named keys the run is handed. Names only, never values. */
  readonly keys: readonly string[];
}
