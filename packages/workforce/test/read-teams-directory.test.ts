/**
 * The `TEAM.md` reader — a team's own description and the instructions every
 * seat on it carries.
 *
 * The premise first (`the premise` below): before this reader existed, a
 * `TEAM.md` planted in a tree was read by nothing and reported by nothing. That
 * is the one check that can catch a reader which was silently already looking,
 * and it is why the suite opens with it rather than with the happy path.
 *
 * Everything after it is the reading contract: what loads, what is refused, and
 * — the rule this convention is most likely to get wrong — the difference
 * between a file that is ABSENT and a file that is EMPTY. Those are two
 * different answers, and both of them have to be checked against an observer
 * that would visibly move if the other one happened.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTeamsDirectory } from "../src/loader/read-teams-directory";
import { readWorkforce } from "../src/loader/read-workforce";
import { TEAM_INSTRUCTIONS_KEY, TEAM_MD } from "../src/manifest";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "read-teams-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** Write a `TEAM.md` at `teams/<team>/`, frontmatter and body as given. */
async function writeTeamMd(team: string, contents: string): Promise<void> {
  const dir = path.join(root, "teams", team);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, TEAM_MD), contents);
}

/** The ordinary case: a description and a body. */
const teamMd = (description: string, body: string): string =>
  `---\ndescription: ${description}\n---\n\n${body}\n`;

/** A worker, so a team folder holds the thing that makes it a team. */
async function writeWorker(
  team: string,
  worker: string,
  frontmatter = "description: A worker",
  body = "You do the thing.",
): Promise<void> {
  const dir = path.join(root, "teams", team, "workers", worker);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "WORKER.md"), `---\n${frontmatter}\n---\n\n${body}\n`);
}

const team = (teams: Array<{ id: string }>, id: string) => teams.find((t) => t.id === id);

describe("the premise", () => {
  /**
   * The counted fact this issue rests on, asserted at RUN TIME rather than by
   * grepping the source: a `TEAM.md` in a tree reached no reader.
   *
   * Kept after the reader shipped, pointed at the reader that did not read it.
   * `readWorkforceDirectory`'s contract is worker slots only, and that promise
   * is what makes this feature a new reader rather than a widened one — so the
   * check is now a regression guard on the worker reader's silence, not a
   * historical note.
   */
  it("is invisible to the worker reader, which reads worker slots and nothing else", async () => {
    await writeWorker("pentest", "recon");
    await writeTeamMd("pentest", teamMd("Red-team ops.", "Stay inside the engagement's scope."));

    const { readWorkforceDirectory } = await import("../src/loader/read-workforce-directory");
    const { workers, errors } = await readWorkforceDirectory(root);

    // The seat still loads — the file changes nothing about the worker walk.
    expect(workers.map((w) => w.id)).toEqual(["pentest.recon"]);
    // And the file itself is neither a record nor a complaint, at that door.
    expect(errors).toEqual([]);
  });

  /**
   * The other half, and the half that fails before this reader exists: the same
   * tree, read by the reader that IS this convention's, produces the team.
   */
  it("is read by the team reader", async () => {
    await writeWorker("pentest", "recon");
    await writeTeamMd("pentest", teamMd("Red-team ops.", "Stay inside the engagement's scope."));

    const { teams, errors } = await readTeamsDirectory(root);

    expect(errors).toEqual([]);
    expect(teams).toEqual([
      {
        id: "pentest",
        description: "Red-team ops.",
        declared: { description: "Red-team ops." },
        instructions: "Stay inside the engagement's scope.\n",
      },
    ]);
  });
});

describe("reading the file", () => {
  /**
   * BR-1. The common case, and the one an empty-string layer would break for
   * every team in every tree that has no file.
   *
   * **Differential, on purpose.** "Nothing happened" is the assertion a broken
   * observer passes for free — a reader that read nothing at all would be green
   * here forever. So the same tree is read twice, and the second read (with the
   * file added, and nothing else changed) has to move. Only the pair says the
   * silence is a decision rather than an absence of machinery.
   */
  it("reports nothing and produces nothing for a team with no TEAM.md", async () => {
    await writeWorker("pentest", "recon");

    const without = await readTeamsDirectory(root);

    expect(without.teams).toEqual([]);
    expect(without.errors).toEqual([]);

    // The control: the only change is the file, so anything the second read
    // shows is what the first read's silence was about.
    await writeTeamMd("pentest", teamMd("Red-team ops.", "Stay in scope."));
    const withFile = await readTeamsDirectory(root);

    expect(withFile.teams.map((t) => t.id)).toEqual(["pentest"]);
    expect(withFile.teams).not.toEqual(without.teams);
  });

  // BR-2. The body verbatim — not trimmed, not reflowed. An author's blank
  // line between paragraphs is theirs.
  it("loads the description and the body verbatim", async () => {
    await writeTeamMd(
      "pentest",
      "---\ndescription: Red-team ops.\n---\n\nFirst rule.\n\nSecond rule.\n",
    );

    const { teams, errors } = await readTeamsDirectory(root);

    expect(errors).toEqual([]);
    expect(team(teams, "pentest")?.instructions).toBe("First rule.\n\nSecond rule.\n");
  });

  // BR-9. The dialect's standing promise, and BR-8a is what keeps it safe.
  it("carries an unclaimed key verbatim", async () => {
    await writeTeamMd(
      "pentest",
      "---\ndescription: Red-team ops.\ncolour: amber\n---\n\nStay in scope.\n",
    );

    const { teams, errors } = await readTeamsDirectory(root);

    expect(errors).toEqual([]);
    expect(team(teams, "pentest")?.declared).toEqual({
      description: "Red-team ops.",
      colour: "amber",
    });
  });

  // BR-4. Whitespace is not instructions — the rule hire already applies to a
  // worker's body, one level up. Asserted as ABSENT rather than as `""`,
  // because an empty string is a value a kind's schema would see.
  it("loads the description and NO instructions for a whitespace-only body", async () => {
    await writeTeamMd("pentest", "---\ndescription: Red-team ops.\n---\n\n   \n\t\n");

    const { teams, errors } = await readTeamsDirectory(root);

    expect(errors).toEqual([]);
    const loaded = team(teams, "pentest");
    expect(loaded?.description).toBe("Red-team ops.");
    expect(loaded && Object.hasOwn(loaded, "instructions")).toBe(false);
  });

  // BR-3. The team's workers still load; this reader never throws.
  it("reports a missing description, under the file's path", async () => {
    await writeWorker("pentest", "recon");
    await writeTeamMd("pentest", "---\nowner: nobody\n---\n\nStay in scope.\n");

    const { teams, errors } = await readTeamsDirectory(root);

    expect(teams).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe(`teams/pentest/${TEAM_MD}`);
    expect(errors[0]!.kind).toBe("team-load-failed");
    expect(errors[0]!.error.message).toContain("description");
  });

  it("reports an empty description", async () => {
    await writeTeamMd("pentest", '---\ndescription: "  "\n---\n\nStay in scope.\n');

    const { teams, errors } = await readTeamsDirectory(root);

    expect(teams).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error.message).toContain("description");
  });

  it("reports a file with no frontmatter at all", async () => {
    await writeTeamMd("pentest", "Stay inside the engagement's scope.\n");

    const { teams, errors } = await readTeamsDirectory(root);

    expect(teams).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.kind).toBe("team-load-failed");
  });

  // BR-5. Never followed, at any level.
  it("refuses a symlinked TEAM.md", async () => {
    await writeWorker("pentest", "recon");
    const outside = path.join(root, "elsewhere.md");
    await fs.writeFile(outside, teamMd("Somewhere else.", "Do as you please."));
    await fs.mkdir(path.join(root, "teams", "pentest"), { recursive: true });
    await fs.symlink(outside, path.join(root, "teams", "pentest", TEAM_MD));

    const { teams, errors } = await readTeamsDirectory(root);

    expect(teams).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe(`teams/pentest/${TEAM_MD}`);
    expect(errors[0]!.error.message).toContain("refused for safety");
  });

  // BR-7. A directory with that name is a mistake; reading it as ABSENT would
  // lose it, which is this epic's recurring failure.
  it("reports a directory where the file belongs, naming the file to write", async () => {
    await fs.mkdir(path.join(root, "teams", "pentest", TEAM_MD), { recursive: true });

    const { teams, errors } = await readTeamsDirectory(root);

    expect(teams).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.kind).toBe("folder-where-file-belongs");
    expect(errors[0]!.error.message).toContain(TEAM_MD);
  });

  // BR-6. Distinct from absent: a file that exists and will not open is
  // instructions the app has LOST.
  it("reports an unreadable TEAM.md, distinctly from an absent one", async () => {
    await writeTeamMd("pentest", teamMd("Red-team ops.", "Stay in scope."));
    await fs.chmod(path.join(root, "teams", "pentest", TEAM_MD), 0o000);

    const { teams, errors } = await readTeamsDirectory(root);

    // Skipped when the test runs as a user that can read anything (root in
    // some CI images), where the mode change cannot produce the condition.
    if (errors.length === 0) {
      expect(teams).toHaveLength(1);
      return;
    }
    expect(teams).toEqual([]);
    expect(errors[0]!.path).toBe(`teams/pentest/${TEAM_MD}`);
    expect(errors[0]!.kind).toBe("team-load-failed");
  });

  /**
   * BR-10. There is no `ORG.md` and no org-level instruction layer.
   *
   * A real team file sits in the same tree, so the reader is demonstrably
   * awake while it passes the other two over. Without it this would be green on
   * a reader that read nothing anywhere.
   */
  it("reads a TEAM.md only inside a team folder, never at org/ or the root", async () => {
    await fs.mkdir(path.join(root, "org"), { recursive: true });
    await fs.writeFile(
      path.join(root, "org", TEAM_MD),
      teamMd("The whole org.", "Everyone obeys this."),
    );
    await fs.writeFile(path.join(root, TEAM_MD), teamMd("The root.", "And this."));
    await writeWorker("pentest", "recon");
    await writeTeamMd("pentest", teamMd("Red-team ops.", "Stay in scope."));

    const { teams, errors } = await readTeamsDirectory(root);

    expect(errors).toEqual([]);
    // Exactly the team's own, and neither of the two planted outside one.
    expect(teams.map((t) => t.id)).toEqual(["pentest"]);
    expect(teams[0]!.instructions).toBe("Stay in scope.\n");
  });

  // BR-13's reading half: two teams, two files, neither one's text on the other.
  it("keeps two teams' instructions apart", async () => {
    await writeTeamMd("pentest", teamMd("Red-team ops.", "Stay in scope."));
    await writeTeamMd("billing", teamMd("Money.", "Never refund without a ticket."));

    const { teams, errors } = await readTeamsDirectory(root);

    expect(errors).toEqual([]);
    expect(team(teams, "pentest")?.instructions).toBe("Stay in scope.\n");
    expect(team(teams, "billing")?.instructions).toBe("Never refund without a ticket.\n");
  });
});

describe("refused declarations", () => {
  /**
   * BR-8 — the keys this convention derives or has already spent.
   *
   * `id` is the folder's; `flow` would read the file as a second seat door,
   * which is the one failure this epic refuses outright; `instructions` is the
   * body, and two sources for one value have no precedence rule.
   */
  it.each([
    ["id", "id: somewhere-else"],
    ["flow", "flow: request-triage"],
    ["instructions", "instructions: From the frontmatter instead."],
  ])("refuses `%s:` by name", async (key, line) => {
    await writeTeamMd("pentest", `---\ndescription: Red-team ops.\n${line}\n---\n\nStay in scope.\n`);

    const { teams, errors } = await readTeamsDirectory(root);

    expect(teams).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.kind).toBe("refused-declaration");
    expect(errors[0]!.path).toBe(`teams/pentest/${TEAM_MD}`);
    expect(errors[0]!.error.message).toContain(key);
  });

  /**
   * BR-8a — the key this feature itself imposes, refused in the file that looks
   * most like the natural place to write it.
   *
   * Written against an EMPTY BODY on purpose. That is the red state that
   * matters: with the body empty there is no layer for the frontmatter to
   * collide with, so a reader that let the key fall through as ordinary
   * metadata would produce a team with no instructions and say nothing about
   * it — the author's text sitting in the file, read by nothing.
   */
  it("refuses the imposed key even when nothing else would notice", async () => {
    await writeTeamMd(
      "pentest",
      `---\ndescription: Red-team ops.\n${TEAM_INSTRUCTIONS_KEY}: Stay inside the engagement's scope.\n---\n`,
    );

    const { teams, errors } = await readTeamsDirectory(root);

    expect(teams).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.kind).toBe("refused-declaration");
    expect(errors[0]!.error.message).toContain(TEAM_INSTRUCTIONS_KEY);
  });
});

describe("the join", () => {
  // BR-2 + BR-12 + BR-13 together, on the surface an app actually calls.
  it("attaches each team's instructions to that team's workers, and nothing to a team with no file", async () => {
    await writeWorker("pentest", "recon");
    await writeWorker("pentest", "scout");
    await writeWorker("billing", "desk");
    await writeTeamMd("pentest", teamMd("Red-team ops.", "Stay in scope."));

    const { workers, teams, teamErrors } = await readWorkforce(root);

    expect(teamErrors).toEqual([]);
    expect(teams.map((t) => t.id)).toEqual(["pentest"]);

    const recon = workers.find((w) => w.id === "pentest.recon")!;
    const scout = workers.find((w) => w.id === "pentest.scout")!;
    const desk = workers.find((w) => w.id === "billing.desk")!;

    expect(recon.teamInstructions).toBe("Stay in scope.\n");
    expect(scout.teamInstructions).toBe("Stay in scope.\n");
    // BR-12: absent, not empty. A `toBeUndefined()` here would pass for `""`
    // reaching the record — the exact value the guardrail forbids.
    expect(Object.hasOwn(desk, "teamInstructions")).toBe(false);
  });

  // BR-12's other arm: a team whose file loaded but whose body was whitespace
  // hands its seats nothing, and is NOT the same as the file being absent —
  // the team record still loads, carrying its description.
  it("gives a team's workers no layer when its TEAM.md has an empty body", async () => {
    await writeWorker("pentest", "recon");
    await writeTeamMd("pentest", "---\ndescription: Red-team ops.\n---\n\n\n");

    const { workers, teams } = await readWorkforce(root);

    expect(teams.map((t) => t.id)).toEqual(["pentest"]);
    expect(teams[0]!.description).toBe("Red-team ops.");
    const recon = workers.find((w) => w.id === "pentest.recon")!;
    expect(Object.hasOwn(recon, "teamInstructions")).toBe(false);
  });

  /**
   * BR-1 / BR-19 at the joined loader: a tree with no `TEAM.md` anywhere is
   * today's result, **byte for byte**.
   *
   * Asserted as the whole record rather than field by field, and paired with
   * the same tree plus the file. A field-by-field check passes for a record
   * that also grew something nobody looked for, and an unpaired one passes for
   * a join that never ran.
   */
  it("adds no field and no error to a tree with no TEAM.md anywhere", async () => {
    await writeWorker("pentest", "recon");

    const before = await readWorkforce(root);

    expect(before.errors).toEqual([]);
    expect(before.skillErrors).toEqual([]);
    expect(before.teams).toEqual([]);
    expect(before.teamErrors).toEqual([]);
    // The exact record, so a key added by the join shows up here whatever it
    // is called — including one holding `undefined`, which `toEqual` ignores
    // but `Object.keys` does not.
    expect(Object.keys(before.workers[0]!).sort()).toEqual(["body", "declared", "id", "skills"]);

    // The control: the same tree, one file added, and the record grows exactly
    // one key. This is what makes the assertion above mean "no layer" rather
    // than "no join".
    await writeTeamMd("pentest", teamMd("Red-team ops.", "Stay in scope."));
    const after = await readWorkforce(root);

    expect(Object.keys(after.workers[0]!).sort()).toEqual([
      "body",
      "declared",
      "id",
      "skills",
      "teamInstructions",
    ]);
  });

  // BR-3's caller-facing half: a broken TEAM.md costs the team its layer and
  // says so, and costs its workers nothing else.
  it("still loads a team's workers when its TEAM.md is broken", async () => {
    await writeWorker("pentest", "recon");
    await writeTeamMd("pentest", "---\nowner: nobody\n---\n\nStay in scope.\n");

    const { workers, teamErrors } = await readWorkforce(root);

    expect(workers.map((w) => w.id)).toEqual(["pentest.recon"]);
    expect(teamErrors).toHaveLength(1);
    expect(Object.hasOwn(workers[0]!, "teamInstructions")).toBe(false);
  });
});

describe("the read happens once per team", () => {
  /**
   * V9 — the N+1 guard, COUNTED.
   *
   * A team's instructions are one value per team, so the file is read once
   * however many seats sit under it. Asserting the records came out right
   * passes with a read per worker, which is the failure this exists for: the
   * skills join reads inside the worker loop because skills are per seat, and
   * copying that shape here would buy a file read per seat for a value
   * identical every time.
   */
  it("reads a team's TEAM.md exactly once for a team of many workers", async () => {
    const workerCount = 7;
    for (let i = 0; i < workerCount; i += 1) await writeWorker("pentest", `recon-${i}`);
    await writeTeamMd("pentest", teamMd("Red-team ops.", "Stay in scope."));

    const target = path.join(root, "teams", "pentest", TEAM_MD);
    const realReadFile = fs.readFile.bind(fs);
    let reads = 0;
    const spy = async (file: never, ...rest: never[]): Promise<never> => {
      if (typeof file === "string" && path.resolve(file) === path.resolve(target)) reads += 1;
      return (await realReadFile(file, ...rest)) as never;
    };
    (fs as { readFile: unknown }).readFile = spy;

    try {
      const { workers } = await readWorkforce(root);
      expect(workers).toHaveLength(workerCount);
      // The counter has to be able to move: if the spy never saw the path, a
      // `toBe(1)` would be measuring a typo in the path rather than the reads.
      expect(reads).toBeGreaterThan(0);
      expect(reads).toBe(1);
    } finally {
      (fs as { readFile: unknown }).readFile = realReadFile;
    }
  });
});
