import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readSkillsDirectory } from "@flow-state-dev/orchestration";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSeatSkills } from "../src/loader/read-seat-skills";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "seat-skills-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** Write `<root>/<levelPath>/<name>/SKILL.md`, plus any supporting files. */
async function writeSkill(
  levelPath: string,
  name: string,
  frontmatter: string,
  files: Record<string, string> = {},
): Promise<void> {
  const dir = path.join(root, ...levelPath.split("/"), name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), frontmatter);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
}

const body = (description: string) => `---\ndescription: ${description}\n---\n\nDo the thing.\n`;

const names = (skills: { name: string }[]) => skills.map((s) => s.name).sort();

describe("readSeatSkills — the levels a seat draws from", () => {
  it("assembles org, team and worker-local skills into one set", async () => {
    await writeSkill("org/skills", "triage", body("org triage"));
    await writeSkill("teams/pentest/skills", "port-scan", body("team port scan"));
    await writeSkill("teams/pentest/workers/recon/skills", "sweep", body("seat sweep"));

    const { skills, errors } = await readSeatSkills(root, {
      team: "pentest",
      worker: "recon",
    });

    expect(errors).toEqual([]);
    expect(names(skills)).toEqual(["port-scan", "sweep", "triage"]);
    // The records are the ones the shared reader returns, unchanged.
    expect(skills.find((s) => s.name === "triage")?.skillMd).toContain("org triage");
  });

  it("treats an absent level as empty rather than as a failure", async () => {
    await writeSkill("teams/pentest/skills", "port-scan", body("team port scan"));

    // No org/skills, no workers/recon/skills anywhere in the tree.
    const { skills, errors } = await readSeatSkills(root, {
      team: "pentest",
      worker: "recon",
    });

    expect(errors).toEqual([]);
    expect(names(skills)).toEqual(["port-scan"]);
  });

  it("reports a level that exists and cannot be listed, under that level's path", async () => {
    await writeSkill("org/skills", "triage", body("org triage"));
    // A *file* where the team's skills folder belongs: present, not listable.
    await fs.mkdir(path.join(root, "teams", "pentest"), { recursive: true });
    await fs.writeFile(path.join(root, "teams", "pentest", "skills"), "not a folder");

    const { skills, errors } = await readSeatSkills(root, {
      team: "pentest",
      worker: "recon",
    });

    expect(names(skills)).toEqual(["triage"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe("teams/pentest/skills");
    expect(errors[0]!.error.message).toMatch(/could not be read/);
  });

  it("re-keys a per-skill error onto that skill's full path", async () => {
    await writeSkill("teams/pentest/skills", "broken", "no frontmatter at all");

    const { skills, errors } = await readSeatSkills(root, {
      team: "pentest",
      worker: "recon",
    });

    expect(skills).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe("teams/pentest/skills/broken");
  });
});

describe("readSeatSkills — a seat's own folder", () => {
  it("includes a worker-local skill without it being listed anywhere", async () => {
    await writeSkill("teams/pentest/workers/recon/skills", "sweep", body("seat sweep"));

    const { skills } = await readSeatSkills(root, { team: "pentest", worker: "recon" });

    expect(names(skills)).toEqual(["sweep"]);
  });

  it("does not leak a seat's own skill to another seat, or another team's to either", async () => {
    await writeSkill("teams/pentest/workers/recon/skills", "sweep", body("recon sweep"));
    await writeSkill("teams/audit/skills", "ledger", body("audit ledger"));

    const recon = await readSeatSkills(root, { team: "pentest", worker: "recon" });
    const clerk = await readSeatSkills(root, { team: "audit", worker: "clerk" });

    expect(names(recon.skills)).toEqual(["sweep"]);
    expect(names(clerk.skills)).toEqual(["ledger"]);
  });
});

describe("readSeatSkills — one name twice in one seat's view", () => {
  it("refuses a name reaching the seat from two levels, naming both paths", async () => {
    await writeSkill("org/skills", "triage", body("ORG BODY"));
    await writeSkill("teams/pentest/skills", "triage", body("TEAM BODY"));

    const { skills, errors } = await readSeatSkills(root, {
      team: "pentest",
      worker: "recon",
    });

    expect(errors).toHaveLength(1);
    const message = errors[0]!.error.message;
    expect(message).toContain("org/skills/triage");
    expect(message).toContain("teams/pentest/skills/triage");
    expect(message).toMatch(/no precedence rule/);
    // Refused, not resolved: neither body is handed back as the winner.
    expect(names(skills)).toEqual([]);
  });

  it("refuses a seat's own folder shadowing its team — there is no local-wins override", async () => {
    await writeSkill("teams/pentest/skills", "triage", body("TEAM BODY"));
    await writeSkill("teams/pentest/workers/recon/skills", "triage", body("SEAT BODY"));

    const { skills, errors } = await readSeatSkills(root, {
      team: "pentest",
      worker: "recon",
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]!.error.message).toContain("teams/pentest/workers/recon/skills/triage");
    expect(skills).toEqual([]);
  });

  it("reports every collision in one run, not just the first", async () => {
    await writeSkill("org/skills", "triage", body("org"));
    await writeSkill("org/skills", "review", body("org"));
    await writeSkill("teams/pentest/skills", "triage", body("team"));
    await writeSkill("teams/pentest/skills", "review", body("team"));
    await writeSkill("teams/pentest/skills", "port-scan", body("team"));

    const { skills, errors } = await readSeatSkills(root, {
      team: "pentest",
      worker: "recon",
    });

    expect(errors.map((e) => e.error.message).join("\n")).toMatch(/triage/);
    expect(errors.map((e) => e.error.message).join("\n")).toMatch(/review/);
    expect(errors).toHaveLength(2);
    // The uncontested skill still comes back.
    expect(names(skills)).toEqual(["port-scan"]);
  });

  it("does not treat two teams sharing a name as a collision", async () => {
    await writeSkill("teams/pentest/skills", "review", body("PENTEST REVIEW"));
    await writeSkill("teams/audit/skills", "review", body("AUDIT REVIEW"));

    const recon = await readSeatSkills(root, { team: "pentest", worker: "recon" });
    const clerk = await readSeatSkills(root, { team: "audit", worker: "clerk" });

    expect(recon.errors).toEqual([]);
    expect(clerk.errors).toEqual([]);
    expect(recon.skills[0]?.skillMd).toContain("PENTEST REVIEW");
    expect(clerk.skills[0]?.skillMd).toContain("AUDIT REVIEW");
  });
});

describe("readSeatSkills — a SKILL.md that declares its own scope", () => {
  const declaresScope = `---\ndescription: tries to pick its own scope\nscope: team\n---\n\nbody\n`;

  it("refuses the file by name and keeps it out of the seat's set", async () => {
    await writeSkill("teams/pentest/skills", "triage", declaresScope);

    const { skills, errors } = await readSeatSkills(root, {
      team: "pentest",
      worker: "recon",
    });

    expect(skills).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe("teams/pentest/skills/triage");
    expect(errors[0]!.error.message).toMatch(/`scope:`/);
  });

  it("leaves the shared reader alone — the same file still loads through it", async () => {
    await writeSkill("teams/pentest/skills", "triage", declaresScope);

    const direct = await readSkillsDirectory(
      path.join(root, "teams", "pentest", "skills"),
    );

    expect(direct.errors).toEqual([]);
    expect(names(direct.skills)).toEqual(["triage"]);
  });
});
