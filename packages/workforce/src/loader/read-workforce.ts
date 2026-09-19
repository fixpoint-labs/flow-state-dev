/**
 * The joined loader — read a workforce tree into records that already carry
 * their own skills.
 *
 * Two readers existed and neither called the other: `readWorkforceDirectory`
 * knows which seats there are, `readSeatSkills` knows what one seat can see.
 * Between them sat the gap this closes — a seat's computed skill union had
 * nowhere to ride into the mint, so a roster loaded from disk hired workers
 * that held no skills at all.
 *
 * This is a JOIN, not a third walker. It calls both readers unchanged and
 * attaches each seat's set to its record; adding another directory walk is the
 * outcome that would put a third answer to "what is in this tree" in the repo.
 *
 * Node-only (by way of both readers), which is why it ships behind the
 * `./loader` subpath rather than the package root.
 */

import {
  readSeatSkills,
  type SeatSkillError,
} from "./read-seat-skills";
import {
  readTeamsDirectory,
  type TeamManifestError,
} from "./read-teams-directory";
import {
  readWorkforceDirectory,
  type ReadWorkforceDirectoryResult,
} from "./read-workforce-directory";
import type { TeamManifest, WorkerManifest } from "../manifest";

/** What {@link readWorkforce} hands back. */
export interface ReadWorkforceResult {
  /**
   * One record per worker that loaded, in walk order, each carrying its own
   * resolved skill union in {@link WorkerManifest.skills} — possibly empty,
   * never absent.
   */
  workers: WorkerManifest[];
  /**
   * Worker-slot and structural failures, exactly as `readWorkforceDirectory`
   * reports them. A path here is a seat, or a set of seats, that should exist
   * and does not.
   */
  errors: ReadWorkforceDirectoryResult["errors"];
  /**
   * Per-seat skill failures — one entry per seat whose read produced any,
   * carrying that seat's id and `readSeatSkills`' own error list.
   *
   * Reported per seat rather than flattened into `errors` because the two are
   * different severities and callers treat them differently: a worker slot that
   * failed is a seat the app does not have, while a skill that failed is a seat
   * running short. Narrow on each entry's `kind` (see `SeatSkillError`).
   *
   * A failure at a SHARED level — the org's `skills/` folder being unlistable,
   * say — reaches every seat that reads it, so it appears once under each. That
   * is the honest shape: it really did cost each of those seats a skill.
   */
  skillErrors: Array<{ worker: string; errors: SeatSkillError[] }>;
  /**
   * One record per team that declared a `TEAM.md`, in walk order.
   *
   * Surfaced rather than only attached to worker records, because the file
   * carries one thing the seats do not: the team's own `description`. Validated
   * and then discarded would be the worse of the two available mistakes —
   * either read a value or do not ask for it.
   *
   * A team with no file is absent here, not present-and-empty.
   */
  teams: TeamManifest[];
  /**
   * Team-file failures, exactly as `readTeamsDirectory` reports them.
   *
   * Their own channel rather than flattened into `errors`, for the reason
   * `skillErrors` has one: the severities differ and callers treat them
   * differently. A worker slot that failed is a seat the app does not have; a
   * `TEAM.md` that failed is a whole team's seats running without instructions
   * their author wrote. Narrow on each entry's `kind` (see
   * `TeamManifestErrorKind`).
   */
  teamErrors: TeamManifestError[];
}

/**
 * Read `<root>` into worker records that carry their own skills.
 *
 * Throws only when `root` itself cannot be read — the same rule both underlying
 * readers follow. Everything else is collected, so one bad folder never costs
 * an app its other workers or a worker its other skills.
 *
 * @param root The workforce tree — the folder holding `org/` and `teams/`.
 * @returns Records ready for `hireWorkforce`, plus the three collected error
 *   channels.
 *
 * @example
 * const { workers, errors, skillErrors, teamErrors } = await readWorkforce("./workforce");
 * if (errors.length > 0 || skillErrors.length > 0 || teamErrors.length > 0) {
 *   throw new Error("short roster");
 * }
 * const seats = hireWorkforce(workers);
 */
export async function readWorkforce(root: string): Promise<ReadWorkforceResult> {
  const { workers, errors } = await readWorkforceDirectory(root);

  // ONCE, for the whole call, into a map. A team's instructions are one value
  // per TEAM — unlike a seat's skills, which are read inside the loop below
  // because they are per SEAT. Copying the skills join's I/O shape here would
  // buy a file read per seat for a value identical every time, and a test that
  // only checked the records came out right would pass anyway.
  const { teams, errors: teamErrors } = await readTeamsDirectory(root);
  const instructionsByTeam = new Map<string, string>(
    teams.flatMap((team) =>
      team.instructions === undefined ? [] : [[team.id, team.instructions] as const],
    ),
  );

  const joined: WorkerManifest[] = [];
  const skillErrors: ReadWorkforceResult["skillErrors"] = [];

  for (const worker of workers) {
    const { team, name } = splitWorkerId(worker.id);
    const seat = await readSeatSkills(root, { team, worker: name });
    const teamInstructions = instructionsByTeam.get(team);
    joined.push({
      ...worker,
      skills: seat.skills,
      // Spread rather than assigned, so a team with no instructions leaves the
      // key ABSENT on the record instead of present-and-undefined. The
      // difference is not cosmetic: the factory imposes the setting from
      // `hasOwn`, and a key that is there holding `undefined` is a team layer
      // the record claims to have read and does not have.
      ...(teamInstructions === undefined ? {} : { teamInstructions }),
    });
    if (seat.errors.length > 0) {
      skillErrors.push({ worker: worker.id, errors: seat.errors });
    }
  }

  return { workers: joined, errors, skillErrors, teams, teamErrors };
}

/**
 * Split a minted worker id back into the two folder names it was made of.
 *
 * Safe because the segment rules exclude `.` deliberately — see
 * `segments.ts`, where that exclusion is called load-bearing for exactly this:
 * a dotted segment would make `a.b.lead` readable two ways. Both halves came
 * through `validateSegment` when the id was minted, so they are re-validated by
 * `readSeatSkills` and not here.
 */
function splitWorkerId(id: string): { team: string; name: string } {
  const at = id.indexOf(".");
  return { team: id.slice(0, at), name: id.slice(at + 1) };
}
