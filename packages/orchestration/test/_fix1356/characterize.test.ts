/**
 * Throwaway characterization of the SHIPPED `readSkillsDirectory`, for FIX-1356.
 *
 * Pins how the reader behaves TODAY so the spec's divergence claims are
 * executed rather than asserted. Nothing here is a proposal — every assertion
 * describes current `main`.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readSkillsDirectory } from "../../src/skills/read-directory";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fix1356-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function write(rel: string, content: string) {
  const full = path.join(tmp, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

describe("D1 - walk shape: a flat readdir, not the teams/<id>/<slot>/ tree", () => {
  it("finds a flat <name>/SKILL.md and does NOT find a team-scoped one", async () => {
    await write("recon/SKILL.md", `---\ndescription: flat one\n---\nbody`);
    await write(
      "teams/pentest/skills/triage/SKILL.md",
      `---\ndescription: team-scoped one\n---\nbody`,
    );
    const { skills, errors } = await readSkillsDirectory(tmp);
    console.log("D1 skills:", skills.map((s) => s.name));
    console.log(
      "D1 errors:",
      errors.map((e) => ({ name: e.name, msg: e.error.message })),
    );
    expect(skills.map((s) => s.name)).toEqual(["recon"]);
    // The team tree is not walked; `teams` is mistaken for a skill folder.
    expect(errors.map((e) => e.name)).toEqual(["teams"]);
    expect(errors[0]!.error.message).toContain("Missing SKILL.md");
  });
});

describe("D2 - error key: `name`, never a path", () => {
  it("keys a per-entry error by bare folder name", async () => {
    await write("broken/SKILL.md", `---\nnot-description: x\n---\nbody`);
    const { errors } = await readSkillsDirectory(tmp);
    console.log("D2 error entry keys:", Object.keys(errors[0]!));
    expect(Object.keys(errors[0]!).sort()).toEqual(["error", "name"]);
    expect(errors[0]!.name).toBe("broken");
    expect("path" in errors[0]!).toBe(false);
  });
});

describe("D3 - present-but-unreadable is reported as absent", () => {
  it("reports an existing-but-unreadable SKILL.md as 'Missing SKILL.md'", async () => {
    // A directory named SKILL.md: it exists, and readFile fails EISDIR. Chosen
    // over a chmod because this suite may run as root, which ignores mode bits.
    await fs.mkdir(path.join(tmp, "weird", "SKILL.md"), { recursive: true });
    const { skills, errors } = await readSkillsDirectory(tmp);
    console.log("D3:", errors.map((e) => e.error.message));
    expect(skills).toEqual([]);
    expect(errors[0]!.error.message).toContain("Missing SKILL.md");
    // The failure that actually happened (EISDIR) is nowhere in the report.
    expect(errors[0]!.error.message).not.toContain("EISDIR");
  });
});

describe("D4 - identity is a bare folder name, not team-qualified", () => {
  it("mints no team qualifier", async () => {
    await write("recon/SKILL.md", `---\ndescription: d\n---\nbody`);
    const { skills } = await readSkillsDirectory(tmp);
    console.log("D4 identity:", skills[0]!.name);
    expect(skills[0]!.name).toBe("recon");
    expect(skills[0]!.name).not.toContain(".");
  });
});

describe("D5 - the folder is the identity, enforced by agreement not refusal", () => {
  it("accepts a `name:` that agrees with the folder, refuses one that disagrees", async () => {
    await write("agree/SKILL.md", `---\nname: agree\ndescription: d\n---\nbody`);
    await write("disagree/SKILL.md", `---\nname: other\ndescription: d\n---\nbody`);
    const { skills, errors } = await readSkillsDirectory(tmp);
    console.log(
      "D5 ok:",
      skills.map((s) => s.name),
      "err:",
      errors.map((e) => e.error.message),
    );
    expect(skills.map((s) => s.name)).toEqual(["agree"]);
    expect(errors[0]!.name).toBe("disagree");
  });
});

describe("D7 - the shipped skill-name rule refuses the dot-joined identity", () => {
  it("refuses a team-qualified `<team>.<name>` skill name", async () => {
    const { validateSkillName } = await import("../../src/skills/skill-md");
    expect(() => validateSkillName("recon")).not.toThrow();
    let msg = "";
    try {
      validateSkillName("pentest.recon");
    } catch (e) {
      msg = (e as Error).message;
    }
    console.log("D7:", msg);
    expect(msg).toContain("lowercase letters, digits, and single hyphens");
  });
});

describe("D6 - unknown frontmatter keys survive the read", () => {
  it("carries an unclaimed key through verbatim", async () => {
    await write("s/SKILL.md", `---\ndescription: d\nteam: pentest\nmine: [a, b]\n---\nbody`);
    const { skills } = await readSkillsDirectory(tmp);
    console.log("D6 carried:", JSON.stringify(skills[0]!.skillMd));
    expect(skills[0]!.skillMd).toContain("team: pentest");
  });
});
