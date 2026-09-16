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

describe("readSeatSkills — the seat named in the arguments", () => {
  // `team` and `worker` are caller-supplied and become path segments, so a
  // segment carrying `..` would read a folder outside the configured root —
  // the same escape the walk's symlink refusal exists to stop.
  it("refuses a team or worker name that would leave the root", async () => {
    const outside = path.join(root, "..", `outside-${path.basename(root)}`);
    await fs.mkdir(path.join(outside, "skills", "exfil"), { recursive: true });
    await fs.writeFile(
      path.join(outside, "skills", "exfil", "SKILL.md"),
      body("outside the root"),
    );

    try {
      await expect(
        // `<root>/teams/../../<outside>/skills` — outside the configured root.
        readSeatSkills(root, {
          team: `../../${path.basename(outside)}`,
          worker: "nobody",
        }),
      ).rejects.toThrow(/Team folder name/);
      await expect(
        readSeatSkills(root, { team: "pentest", worker: "../../elsewhere" }),
      ).rejects.toThrow(/Worker folder name/);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses an empty team or worker name", async () => {
    await expect(readSeatSkills(root, { team: "", worker: "recon" })).rejects.toThrow(
      /Team folder name/,
    );
    await expect(readSeatSkills(root, { team: "pentest", worker: "" })).rejects.toThrow(
      /Worker folder name/,
    );
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

  it("carries every colliding path on the entry, in read order, across all three levels", async () => {
    // Three levels, not two. The list is built by appending as each level is
    // read, so a bug that keeps only the first and last pair — or that stops
    // appending once a name is already contested — still satisfies a two-level
    // case. This is the case that can tell them apart.
    await writeSkill("org/skills", "triage", body("ORG BODY"));
    await writeSkill("teams/pentest/skills", "triage", body("TEAM BODY"));
    await writeSkill("teams/pentest/workers/recon/skills", "triage", body("SEAT BODY"));

    const { skills, errors } = await readSeatSkills(root, {
      team: "pentest",
      worker: "recon",
    });

    expect(errors).toHaveLength(1);
    const entry = errors[0]!;
    if (entry.kind !== "duplicate-skill-name") {
      throw new Error(`expected a collision, got ${entry.kind}`);
    }
    expect(entry.paths).toEqual([
      "org/skills/triage",
      "teams/pentest/skills/triage",
      "teams/pentest/workers/recon/skills/triage",
    ]);
    // Reachable without parsing the message, which is where they used to be
    // the only copy.
    for (const where of entry.paths) expect(entry.error.message).toContain(where);
    // All three dropped. None of them is the one the seat got.
    expect(names(skills)).toEqual([]);
  });

  it("keys a collision by where the name was first seen, not by the innermost level", async () => {
    // `path` names the thing that failed on every other kind, so on this one it
    // must not read as the copy that won — a seat-level file keyed as *the*
    // path is exactly the local-wins rule this refusal denies. Keyed by first
    // sighting instead, the same rule the rest of the array is ordered by.
    await writeSkill("teams/pentest/skills", "triage", body("TEAM BODY"));
    await writeSkill("teams/pentest/workers/recon/skills", "triage", body("SEAT BODY"));

    const { errors } = await readSeatSkills(root, { team: "pentest", worker: "recon" });

    const entry = errors[0]!;
    if (entry.kind !== "duplicate-skill-name") {
      throw new Error(`expected a collision, got ${entry.kind}`);
    }
    expect(entry.path).toBe("teams/pentest/skills/triage");
    expect(entry.path).toBe(entry.paths[0]);
    expect(entry.paths).toEqual([
      "teams/pentest/skills/triage",
      "teams/pentest/workers/recon/skills/triage",
    ]);
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

describe("readSeatSkills — a symlink on the way to a level", () => {
  // `lstat` answers for the final component only; the OS resolves every one
  // above it. So a symlinked *intermediate* is followed unless the walk
  // classifies it, and the level beneath it loads from outside the configured
  // root. Every position is covered rather than one: a probe that stopped at
  // the first would go green with the rest of the hole still open.
  const positions = [
    { link: "org", skillsUnder: "skills" },
    { link: "teams", skillsUnder: "pentest/skills" },
    { link: "teams/pentest", skillsUnder: "skills" },
    { link: "teams/pentest/workers", skillsUnder: "recon/skills" },
    { link: "teams/pentest/workers/recon", skillsUnder: "skills" },
  ];

  it.each(positions)(
    "refuses a symlinked $link and loads nothing through it",
    async ({ link, skillsUnder }) => {
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), "seat-skills-outside-"));
      try {
        const exfil = path.join(outside, ...skillsUnder.split("/"), "exfil");
        await fs.mkdir(exfil, { recursive: true });
        await fs.writeFile(path.join(exfil, "SKILL.md"), body("outside the root"));

        const linkPath = path.join(root, ...link.split("/"));
        await fs.mkdir(path.dirname(linkPath), { recursive: true });
        await fs.symlink(outside, linkPath, "dir");

        const { skills, errors } = await readSeatSkills(root, {
          team: "pentest",
          worker: "recon",
        });

        // Nothing from outside the configured root reaches the seat.
        expect(names(skills)).toEqual([]);
        // Reported once, under the refused component's own path — not once per
        // level that would have passed through it.
        expect(errors).toHaveLength(1);
        expect(errors[0]!.path).toBe(link);
        expect(errors[0]!.error.message).toMatch(/refused for safety/);
      } finally {
        await fs.rm(outside, { recursive: true, force: true });
      }
    },
  );
});

describe("readSeatSkills — the configured root", () => {
  it("throws when the root itself cannot be read, rather than reporting an empty set", async () => {
    const missing = path.join(root, "no-such-workforce-root");

    // A clean `errors` has to mean "read it, found nothing wrong". Without
    // this, a mistyped root makes every level absent and boots the seat with
    // no skills and no signal.
    await expect(
      readSeatSkills(missing, { team: "pentest", worker: "recon" }),
    ).rejects.toThrow(/Failed to read workforce directory/);
  });

  it("stays silent for a root that is there with none of the levels present", async () => {
    const { skills, errors } = await readSeatSkills(root, {
      team: "pentest",
      worker: "recon",
    });

    expect(skills).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("readSeatSkills — which condition each report is", () => {
  // Six conditions land in one flat `errors` array. Before `kind`, the only way
  // to tell them apart was a regex over the message, so a caller could not
  // tolerate one class while refusing another. Each case below pins one
  // specific kind to one specific scenario — asserting only that some kind is
  // present would pass with every entry mistagged the same way.

  it("tags a level that exists and cannot be listed", async () => {
    await fs.mkdir(path.join(root, "teams", "pentest"), { recursive: true });
    await fs.writeFile(path.join(root, "teams", "pentest", "skills"), "not a folder");

    const { errors } = await readSeatSkills(root, { team: "pentest", worker: "recon" });

    expect(errors).toHaveLength(1);
    expect(errors[0]!.kind).toBe("unlistable-level");
    expect(errors[0]!.path).toBe("teams/pentest/skills");
  });

  it("tags a symlinked folder on the way to a level apart from the level itself", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "seat-skills-outside-"));
    try {
      await fs.mkdir(path.join(root, "teams"), { recursive: true });
      await fs.symlink(outside, path.join(root, "teams", "pentest"), "dir");

      const { errors } = await readSeatSkills(root, { team: "pentest", worker: "recon" });

      // `teams/pentest` is an ancestor of two of the three levels, so it is
      // reported once under its own path — not once per level beneath it.
      expect(errors).toHaveLength(1);
      expect(errors[0]!.kind).toBe("refused-symlinked-ancestor");
      expect(errors[0]!.path).toBe("teams/pentest");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("tags a level's own skills folder being a symlink", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "seat-skills-outside-"));
    try {
      await fs.mkdir(path.join(root, "org"), { recursive: true });
      await fs.symlink(outside, path.join(root, "org", "skills"), "dir");

      const { errors } = await readSeatSkills(root, { team: "pentest", worker: "recon" });

      // The leaf is classified by the shared primitive rather than by the
      // ancestor walk, so it is a distinct condition from the one above.
      expect(errors).toHaveLength(1);
      expect(errors[0]!.kind).toBe("refused-symlinked-level");
      expect(errors[0]!.path).toBe("org/skills");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("tags a skill folder that failed to load", async () => {
    await writeSkill("teams/pentest/skills", "broken", "no frontmatter at all");

    const { errors } = await readSeatSkills(root, { team: "pentest", worker: "recon" });

    expect(errors).toHaveLength(1);
    expect(errors[0]!.kind).toBe("skill-load-failed");
    expect(errors[0]!.path).toBe("teams/pentest/skills/broken");
  });

  it("tags a SKILL.md that declares the refused scope key", async () => {
    await writeSkill(
      "teams/pentest/skills",
      "greedy",
      `---\ndescription: picks its own scope\nscope: team\n---\n\nbody\n`,
    );

    const { errors } = await readSeatSkills(root, { team: "pentest", worker: "recon" });

    expect(errors).toHaveLength(1);
    expect(errors[0]!.kind).toBe("refused-scope-key");
    expect(errors[0]!.path).toBe("teams/pentest/skills/greedy");
  });

  it("tags a name the seat would have seen twice", async () => {
    await writeSkill("org/skills", "triage", body("org triage"));
    await writeSkill("teams/pentest/skills", "triage", body("team triage"));

    const { errors } = await readSeatSkills(root, { team: "pentest", worker: "recon" });

    expect(errors).toHaveLength(1);
    expect(errors[0]!.kind).toBe("duplicate-skill-name");
  });

  it("keeps four conditions apart in one read rather than tagging them alike", async () => {
    // The case the discriminant exists for: one seat, several things wrong at
    // once, and a caller that wants to tolerate a malformed folder while still
    // refusing a contested name.
    await writeSkill("org/skills", "triage", body("org triage"));
    await writeSkill("org/skills", "broken", "no frontmatter at all");
    await writeSkill(
      "org/skills",
      "greedy",
      `---\ndescription: picks its own scope\nscope: org\n---\n\nbody\n`,
    );
    await writeSkill("teams/pentest/skills", "triage", body("team triage"));
    // A file where the seat's own skills folder belongs: present, not listable.
    await fs.mkdir(path.join(root, "teams", "pentest", "workers", "recon"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, "teams", "pentest", "workers", "recon", "skills"),
      "not a folder",
    );

    const { skills, errors } = await readSeatSkills(root, {
      team: "pentest",
      worker: "recon",
    });

    expect(errors.map((e) => `${e.kind} @ ${e.path}`).sort()).toEqual([
      "duplicate-skill-name @ org/skills/triage",
      "refused-scope-key @ org/skills/greedy",
      "skill-load-failed @ org/skills/broken",
      "unlistable-level @ teams/pentest/workers/recon/skills",
    ]);
    // The every-level list belongs to the one condition that has more than one
    // path; the other three each failed at the single path they are keyed by.
    expect(errors.filter((e) => "paths" in e).map((e) => e.kind)).toEqual([
      "duplicate-skill-name",
    ]);
    // Nothing uncontested survived this tree, so none is silently dropped.
    expect(names(skills)).toEqual([]);
  });

  it("carries the message text unchanged beside the kind", async () => {
    // `kind` is additive: a caller still reading the message keeps working.
    await writeSkill("org/skills", "triage", body("org triage"));
    await writeSkill("teams/pentest/skills", "triage", body("team triage"));

    const { errors } = await readSeatSkills(root, { team: "pentest", worker: "recon" });

    expect(errors[0]!.kind).toBe("duplicate-skill-name");
    expect(errors[0]!.error.message).toMatch(/no precedence rule/);
    expect(errors[0]!.error.message).toContain("org/skills/triage");
  });
});
