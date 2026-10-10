/**
 * The joined loader reads each skills level once per call, not once per worker.
 *
 * The org's `skills/` folder is seen by every worker, and a team's by every
 * worker on that team. Read per worker, boot cost grows as workers × shared
 * levels: a hundred workers over fifty org skills took seconds to load. What is
 * pinned here is both halves of the fix — the shared levels are read once, and
 * no worker's result moves: each still equals what `readSeatSkills` returns for
 * that worker alone, failures at a shared level included.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readSkillsDirectory = vi.hoisted(() => vi.fn());
vi.mock("@flow-state-dev/orchestration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/orchestration")>();
  readSkillsDirectory.mockImplementation(actual.readSkillsDirectory);
  return { ...actual, readSkillsDirectory };
});

import { readSeatSkills } from "../src/loader/read-seat-skills";
import { readWorkforce } from "../src/loader/read-workforce";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "read-workforce-shared-"));
  readSkillsDirectory.mockClear();
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeWorker(dir: string): Promise<void> {
  await fs.mkdir(path.join(root, ...dir.split("/")), { recursive: true });
  await fs.writeFile(
    path.join(root, ...dir.split("/"), "WORKER.md"),
    "---\ndescription: A worker\n---\n\nYou do the thing.\n",
  );
}

async function writeSkill(levelPath: string, name: string, frontmatter?: string): Promise<void> {
  const dir = path.join(root, ...levelPath.split("/"), name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\n${frontmatter ?? `description: ${name}`}\n---\n\nDo the ${name} thing.\n`,
  );
}

/** Which levels `readSkillsDirectory` was asked for, relative to the root, with repeats. */
const levelsRead = () =>
  readSkillsDirectory.mock.calls
    .map(([dir]) => path.relative(root, dir as string).split(path.sep).join("/"))
    .sort();

describe("readWorkforce — shared skill levels", () => {
  it("reads the org's and each team's skills once, however many workers see them", async () => {
    await writeSkill("org/skills", "house-style");
    await writeSkill("teams/qa/skills", "regression");
    await writeSkill("teams/sec/skills", "threat-model");
    for (const worker of ["a", "b", "c"]) await writeWorker(`teams/qa/workers/${worker}`);
    for (const worker of ["d", "e"]) await writeWorker(`teams/sec/workers/${worker}`);
    await writeWorker("org/workers/chief");

    const { workers, skillErrors } = await readWorkforce(root);

    expect(skillErrors).toEqual([]);
    expect(workers).toHaveLength(6);
    // Read per worker this was org/skills six times, qa's three, sec's twice.
    expect(levelsRead()).toEqual(["org/skills", "teams/qa/skills", "teams/sec/skills"]);
  });

  it("hands each worker exactly what reading that worker alone returns", async () => {
    await writeSkill("org/skills", "house-style");
    await writeSkill("org/skills", "review");
    // Refused at a shared level: must still be reported under every worker it reaches.
    await writeSkill("org/skills", "picky", "description: picks its own scope\nscope: team");
    await writeSkill("teams/qa/skills", "regression");
    // A skill folder that fails to load, at a shared team level.
    await fs.mkdir(path.join(root, "teams", "qa", "skills", "broken"), { recursive: true });
    await writeWorker("teams/qa/workers/tester");
    // Collides with the org's `review` for this worker only.
    await writeSkill("teams/qa/workers/tester/skills", "review");
    await writeWorker("teams/qa/workers/lead");
    // A team whose skills folder is a file: present and unlistable.
    await writeWorker("teams/sec/workers/auditor");
    await fs.writeFile(path.join(root, "teams", "sec", "skills"), "not a folder");
    await writeWorker("org/workers/chief");

    const { workers, skillErrors } = await readWorkforce(root);

    for (const [team, worker, id] of [
      ["qa", "tester", "qa.tester"],
      ["qa", "lead", "qa.lead"],
      ["sec", "auditor", "sec.auditor"],
      [undefined, "chief", "chief"],
    ] as const) {
      const alone = await readSeatSkills(root, { team, worker });
      const joined = workers.find((w) => w.id === id);
      expect(joined, id).toBeDefined();
      expect(joined!.skills, id).toEqual(alone.skills);
      expect(skillErrors.find((e) => e.worker === id)?.errors ?? [], id).toEqual(alone.errors);
    }

    // The shared failures really did reach more than one worker each.
    const reportedUnder = (p: string) =>
      skillErrors.filter((e) => e.errors.some((err) => err.path === p)).map((e) => e.worker).sort();
    expect(reportedUnder("org/skills/picky")).toEqual(["chief", "qa.lead", "qa.tester", "sec.auditor"]);
    expect(reportedUnder("teams/qa/skills/broken")).toEqual(["qa.lead", "qa.tester"]);
    expect(reportedUnder("org/skills/review")).toEqual(["qa.tester"]);
  });

  it("gives each worker its own records, so editing one worker's never edits another's", async () => {
    await writeSkill("org/skills", "house-style");
    await writeSkill("org/skills", "picky", "description: picks its own scope\nscope: team");
    await writeWorker("teams/qa/workers/a");
    await writeWorker("teams/qa/workers/b");

    const { workers, skillErrors } = await readWorkforce(root);

    const [first, second] = skillErrors.map((e) => e.errors[0]!);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);

    const [a, b] = workers.map((w) => w.skills![0]!);
    a.skillMd = "edited by one caller";
    expect(b.skillMd).toMatch(/Do the house-style thing/);
  });
});
