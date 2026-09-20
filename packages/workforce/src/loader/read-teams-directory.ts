/**
 * The team convention loader — read each team's own `TEAM.md` into a neutral
 * record.
 *
 * One optional file at `<root>/teams/<teamId>/TEAM.md`, holding what a team is
 * (`description`, required when the file exists) and what every seat on it is
 * told (the Markdown body). It builds no flow, declares no seat and mints no
 * address: turning a record into a running seat is the seat factory's job, and
 * a team is not a seat.
 *
 * **Its own reader rather than a widened one.** `readWorkforceDirectory` is
 * already standing at the team folder, but its whole contract is *worker slots
 * only* — a team's siblings are passed over in silence, and the docs teach that
 * as a rule. A team-level file is a different convention, so it gets the small
 * reader this is and shares the walk underneath, which is what
 * {@link walkTeams} was extracted for.
 *
 * Two rules run through it, as through every reader here. **Symlinks are never
 * followed.** And **absence is the one silent outcome**: a team folder with no
 * `TEAM.md` is not a problem of any kind, while a `TEAM.md` that exists and
 * cannot be read is instructions the app has lost, and is reported.
 *
 * Node-only (`node:fs`), which is why it ships behind the `./loader` subpath
 * rather than the package root.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  parseFrontmatterYaml,
  splitFrontmatter,
} from "@flow-state-dev/orchestration";
import {
  TEAM_MD,
  refusedTeamDeclarationMessage,
  type TeamManifest,
} from "../manifest";
import {
  type PathReport,
  classify,
  openRoot,
  refusedSymlink,
  unreadable,
  walkTeams,
} from "./structural-directory";

/**
 * Why one thing that should have produced a team record did not — the
 * discriminant on every entry in {@link ReadTeamsDirectoryResult.errors}.
 *
 * Four conditions land in one flat array, and a caller that wants to tolerate
 * one class while refusing another needs to tell them apart without matching on
 * `error.message`. Its own union rather than a borrowed one: a reader's
 * conditions are its own, and the walk beneath serves more than one reader.
 */
export type TeamManifestErrorKind =
  /** `teams`, or one team folder, is a symlink or is there and could not be listed. Every team under it is missing. */
  | "unreadable-slot"
  /** A directory sits where the file belongs — the mistake an author arriving from `workers/` or `channels/` makes. */
  | "folder-where-file-belongs"
  /** The file did not load: a symlink, an unreadable file, no frontmatter, or a missing `description`. */
  | "team-load-failed"
  /** The file declares a key the framework derives or imposes, so the team's layer is left out. */
  | "refused-declaration";

/** One path that should have produced a team record and did not. */
export type TeamManifestError = PathReport<TeamManifestErrorKind>;

/** What {@link readTeamsDirectory} hands back. */
export interface ReadTeamsDirectoryResult {
  /**
   * One record per team whose `TEAM.md` loaded, in walk order.
   *
   * Teams with no file are **absent from this list**, not present-and-empty:
   * having no team file is the common case, and a placeholder record would make
   * every such team look like one that declared nothing.
   */
  teams: TeamManifest[];
  /**
   * One entry per path that should have produced a team record and did not,
   * keyed by its slash-separated path relative to the root.
   *
   * Collected rather than thrown, the standing posture of every reader here: a
   * library that hands back data does not get to set an app's boot policy. A
   * team reported here loads its workers all the same, and they load **without
   * the layer** — so a caller that boots past a non-empty `errors` runs those
   * seats short of instructions their author wrote. That is the caller's
   * standing call to make explicitly, and it is very often the right one to
   * make fatal.
   */
  errors: TeamManifestError[];
}

/**
 * Read every `<root>/teams/<teamId>/TEAM.md` and return one record per team
 * that has one.
 *
 * Throws only when `root` itself is refused — a symlink, or a path that cannot
 * be read at all — which is the rule every reader here follows. A root with no
 * `teams/` is an empty result. Everything else that goes wrong lands in
 * `errors`, so one broken file never costs an app its other teams.
 *
 * @param root The workforce tree — the folder holding `org/` and `teams/`.
 *
 * @example
 * const { teams, errors } = await readTeamsDirectory("./workforce");
 */
export async function readTeamsDirectory(
  root: string,
): Promise<ReadTeamsDirectoryResult> {
  const teams: TeamManifest[] = [];
  const errors: TeamManifestError[] = [];

  await openRoot(root);

  /** File a structural refusal the shared walk met on the way to a team. */
  const report = (at: string, error: Error): void => {
    errors.push({ path: at, error, kind: "unreadable-slot" });
  };

  for await (const team of walkTeams(root, report)) {
    const filePath = `${team.path}/${TEAM_MD}`;
    const file = path.join(team.dir, TEAM_MD);
    const entry = await classify(file);

    // The one silent outcome, and the common case: this team simply does not
    // have a file. Nothing is produced and nothing is said.
    if (entry.kind === "absent") continue;

    if (entry.kind === "symlink") {
      errors.push({
        path: filePath,
        error: refusedSymlink(TEAM_MD, `${team.id}/${TEAM_MD}`),
        kind: "team-load-failed",
      });
      continue;
    }

    if (entry.kind === "unreadable") {
      errors.push({
        path: filePath,
        error: unreadable(TEAM_MD, `${team.id}/${TEAM_MD}`, entry.error),
        kind: "team-load-failed",
      });
      continue;
    }

    // Reported rather than skipped, and it is the loudest error here. Reading a
    // directory of that name as ABSENT would silently lose whatever an author
    // put inside it — and an author arriving from `workers/` or `channels/`,
    // where a folder IS the thing, makes exactly this mistake.
    if (entry.kind === "directory") {
      errors.push({
        path: filePath,
        error: new Error(
          `"${TEAM_MD}" is a directory. A team file is a file, not a folder — write the ` +
            `team's description and instructions as "${TEAM_MD}" in this team's folder instead.`,
        ),
        kind: "folder-where-file-belongs",
      });
      continue;
    }

    let loaded: { declared: Record<string, unknown>; body: string };
    try {
      loaded = parseTeamMd(await fs.readFile(file, "utf8"), team.id);
    } catch (err) {
      errors.push({ path: filePath, error: err as Error, kind: "team-load-failed" });
      continue;
    }

    // A separate condition for a caller, so it is a separate branch: a file
    // that could not be read is an author's typo, and a file declaring what the
    // framework derives or imposes is an author's misunderstanding. Checked
    // here rather than inside the parse so the two stay tellable apart by
    // control flow, the way the workers, channels and resources readers keep
    // them apart.
    const refused = refusedTeamDeclarationMessage(loaded.declared);
    if (refused !== undefined) {
      errors.push({
        path: filePath,
        error: new Error(`${TEAM_MD} in "${team.id}/" ${refused}`),
        kind: "refused-declaration",
      });
      continue;
    }

    teams.push({
      id: team.id,
      description: loaded.declared["description"] as string,
      declared: loaded.declared,
      // ABSENT, not `""`, when the body is whitespace. An empty layer would be
      // a value every kind's schema could see — a different bag for every team
      // that wrote no instructions — and the seat factory already learned this
      // one level up, where an empty body handed over as a setting turned every
      // thin seat into a failed hire.
      ...(loaded.body.trim().length > 0 ? { instructions: loaded.body } : {}),
    });
  }

  return { teams, errors };
}

/**
 * Parse a `TEAM.md` into its declared settings and its body. Shares the
 * `WORKER.md`/`SKILL.md` frontmatter dialect deliberately: these are the
 * convention files an author writes by hand, and a second dialect would mean
 * learning one teaches the wrong thing about the other.
 *
 * `description` is required — the dialect's rule, not a consumer's — and
 * everything else is carried verbatim. The keys the framework derives or
 * imposes are refused by the caller, which reports that as its own condition.
 *
 * Throws when the file cannot produce a record; the caller turns that into an
 * `errors` entry keyed by the file's path.
 */
function parseTeamMd(
  text: string,
  teamId: string,
): { declared: Record<string, unknown>; body: string } {
  const { yaml, body } = splitFrontmatter(text);
  if (yaml.trim().length === 0) {
    throw new Error(
      `${TEAM_MD} in "${teamId}/" has no frontmatter — a team file needs at least a \`description\``,
    );
  }

  const declared = parseFrontmatterYaml(yaml);
  const description = declared["description"];
  if (typeof description !== "string" || description.trim().length === 0) {
    throw new Error(`${TEAM_MD} in "${teamId}/" must declare a non-empty \`description\``);
  }

  return { declared, body };
}
