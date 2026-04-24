import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readSkillsDirectory } from "../src/read-directory";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skills-test-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeSkill(
  name: string,
  manifest: string,
  files: Record<string, string> = {},
) {
  const skillDir = path.join(tmp, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), manifest);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(skillDir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
}

describe("readSkillsDirectory", () => {
  it("returns one entry per <name>/SKILL.md folder", async () => {
    await writeSkill("foo", `---\ndescription: foo\n---\n\nbody`);
    await writeSkill("bar", `---\ndescription: bar\n---\n\nbody`);
    const { skills, errors } = await readSkillsDirectory(tmp);
    expect(errors).toEqual([]);
    expect(skills.map((s) => s.name).sort()).toEqual(["bar", "foo"]);
  });

  it("collects nested supporting files", async () => {
    await writeSkill(
      "code",
      `---\ndescription: code\n---\n\nbody`,
      {
        "reference/patterns.md": "# Patterns",
        "scripts/run.py": "print('hi')",
      },
    );
    const { skills } = await readSkillsDirectory(tmp);
    const code = skills.find((s) => s.name === "code")!;
    expect(code.files?.find((f) => f.path === "reference/patterns.md")?.content).toBe(
      "# Patterns",
    );
    expect(code.files?.find((f) => f.path === "scripts/run.py")?.content).toBe(
      "print('hi')",
    );
  });

  it("collects errors for malformed skills but continues with valid ones", async () => {
    await writeSkill("good", `---\ndescription: good\n---\n\nbody`);
    await writeSkill("bad", `not valid yaml frontmatter`);
    const { skills, errors } = await readSkillsDirectory(tmp);
    expect(skills.map((s) => s.name)).toEqual(["good"]);
    expect(errors.map((e) => e.name)).toContain("bad");
  });

  it("rejects symlinked skill folders", async () => {
    await writeSkill("real", `---\ndescription: real\n---\n\nbody`);
    await fs.symlink(path.join(tmp, "real"), path.join(tmp, "linked"));
    const { skills, errors } = await readSkillsDirectory(tmp);
    expect(skills.map((s) => s.name)).toEqual(["real"]);
    expect(errors.find((e) => e.name === "linked")).toBeDefined();
  });

  it("skips ignored filenames", async () => {
    await writeSkill("foo", `---\ndescription: foo\n---\n\nbody`, {
      ".DS_Store": "junk",
      "real.md": "real",
    });
    const { skills } = await readSkillsDirectory(tmp);
    const foo = skills[0]!;
    expect(foo.files?.map((f) => f.path)).toContain("real.md");
    expect(foo.files?.map((f) => f.path)).not.toContain(".DS_Store");
  });

  it("respects include / exclude filters", async () => {
    await writeSkill("a", `---\ndescription: a\n---\n\nx`);
    await writeSkill("b", `---\ndescription: b\n---\n\nx`);
    await writeSkill("c", `---\ndescription: c\n---\n\nx`);

    const includeOnly = await readSkillsDirectory(tmp, { include: ["a", "b"] });
    expect(includeOnly.skills.map((s) => s.name).sort()).toEqual(["a", "b"]);

    const excluded = await readSkillsDirectory(tmp, { exclude: ["b"] });
    expect(excluded.skills.map((s) => s.name).sort()).toEqual(["a", "c"]);
  });

  it("rejects skill names not matching [a-z0-9-]", async () => {
    await writeSkill("BadName", `---\ndescription: bad\n---\n\nbody`);
    const { skills, errors } = await readSkillsDirectory(tmp);
    expect(skills).toEqual([]);
    expect(errors.find((e) => e.name === "BadName")).toBeDefined();
  });
});
