/**
 * Throwaway characterization of the SHIPPED skills substrate, for FIX-1356.
 *
 * Pins how things behave TODAY so the spec's load-bearing claims are executed
 * rather than asserted. Nothing here is a proposal — every assertion describes
 * current `main`.
 *
 * Scoped to the four claims the "ratify, don't align" fork actually rests on
 * (D1-D3, D7) plus the one premise under Decision 3 (C1). Behaviour the spec
 * marks as *already agreeing* with the sibling conventions — bare identity,
 * folder/`name:` agreement, unknown keys surviving — is covered by the
 * package's own `test/skills/read-directory.test.ts` and is not re-pinned here.
 *
 * Set `FIX1356_LOG=1` to print what each case observed.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readSkillsDirectory } from "../../src/skills/read-directory";
import { ensureSeeded } from "../../src/skills/seeding";
import { createMockSkillsCollection } from "../skills/mocks";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const log = (...args: unknown[]) => {
  if (process.env["FIX1356_LOG"]) console.log(...args);
};

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
    log("D1 skills:", skills.map((s) => s.name));
    log("D1 errors:", errors.map((e) => ({ name: e.name, msg: e.error.message })));
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
    log("D2 error entry keys:", Object.keys(errors[0]!));
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
    log("D3:", errors.map((e) => e.error.message));
    expect(skills).toEqual([]);
    expect(errors[0]!.error.message).toContain("Missing SKILL.md");
    // The failure that actually happened (EISDIR) is nowhere in the report.
    expect(errors[0]!.error.message).not.toContain("EISDIR");
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
    log("D7:", msg);
    expect(msg).toContain("lowercase letters, digits, and single hyphens");
  });
});

describe("C1 - two same-named skills: the second silently overwrites the first", () => {
  it("stores one row, keeps the LAST body, and reports nothing (premise under Decision 3)", async () => {
    // What a cross-level collision produces once both levels are concatenated:
    // two InitialSkills sharing a name, different bodies.
    const orgTriage = {
      name: "triage",
      skillMd: `---\ndescription: org triage\n---\nORG BODY`,
    };
    const teamTriage = {
      name: "triage",
      skillMd: `---\ndescription: team triage\n---\nTEAM BODY`,
    };

    const c = createMockSkillsCollection();
    await ensureSeeded(c, [orgTriage, teamTriage]);

    const stored = c._store.get("skills/triage/SKILL.md");
    const meta = c._store.get("skills/_meta")!;
    const names = meta.state.seededNames as string[];

    log("C1 stored body:", stored?.content);
    log("C1 seededNames:", names);

    // One row, not two: the name is the key.
    const triageKeys = [...c._store.keys()].filter((k: string) =>
      k.startsWith("skills/triage/"),
    );
    expect(triageKeys).toEqual(["skills/triage/SKILL.md"]);

    // The LAST declaration won outright. The org one is gone, with nothing
    // anywhere recording that it ever existed. `ensureSeeded` returns void and
    // has no error channel, so there is no place a report could even appear.
    expect(stored?.content).toContain("TEAM BODY");
    expect(stored?.content).not.toContain("ORG BODY");

    // Both were treated as additions — the "already seeded" guard reads meta
    // once before the loop, so it never sees a name added during the same pass.
    expect(names.filter((n) => n === "triage")).toHaveLength(2);
  });
});

describe("R47 - does 'unknown keys verbatim' let a file overwrite a derived field?", () => {
  // The skills convention derives TWO fields, so it is not exempt by inspection:
  //   `name`  <- the folder
  //   `files` <- the directory walk
  // Both are probed below. `description` is declared, not derived.

  it("does NOT let frontmatter `files:` displace the walked file list", async () => {
    await write(
      "s/SKILL.md",
      `---\ndescription: d\nfiles:\n  - path: injected.md\n    content: INJECTED\n---\nbody`,
    );
    await write("s/reference/real.md", "REAL");

    const { skills, errors } = await readSkillsDirectory(tmp);
    const files = skills[0]!.files ?? [];
    log("R47 files derived:", files.map((f) => f.path));
    log("R47 errors:", errors.map((e) => e.error.message));

    // The walk wins: the real supporting file is present and the declared one
    // never becomes a file entry.
    expect(files.map((f) => f.path).sort()).toEqual(["reference/real.md"]);
    expect(files.find((f) => f.content === "INJECTED")).toBeUndefined();
  });

  it("does NOT let frontmatter `_seededAt:` survive into the stored state", async () => {
    // The one derived value that DOES share a destination with the passthrough
    // bag: skill *state* is flat, and `_seededAt` is framework-written.
    const skill = {
      name: "s",
      skillMd: `---\ndescription: d\n_seededAt: "1999-01-01T00:00:00.000Z"\n---\nbody`,
    };
    const c = createMockSkillsCollection();
    await ensureSeeded(c, [skill]);

    const state = c._store.get("skills/s/SKILL.md")!.state as Record<string, unknown>;
    log("R47 _seededAt stored:", state["_seededAt"]);
    // Derivation runs AFTER the passthrough, so the framework's value wins.
    expect(state["_seededAt"]).not.toBe("1999-01-01T00:00:00.000Z");
    expect(String(state["_seededAt"])).toMatch(/^20\d\d-/);
  });

  it("refuses a `name:` that disagrees with the folder, so identity cannot be overwritten", async () => {
    await write("agree/SKILL.md", `---\nname: agree\ndescription: d\n---\nbody`);
    await write("disagree/SKILL.md", `---\nname: other\ndescription: d\n---\nbody`);
    const { skills, errors } = await readSkillsDirectory(tmp);
    log("R47 loaded:", skills.map((s) => s.name));
    log("R47 refused:", errors.map((e) => e.error.message));
    // The folder wins by *agreement*, not by the key being ignored or stripped:
    // a disagreeing file is refused outright rather than silently corrected.
    expect(skills.map((s) => s.name)).toEqual(["agree"]);
    expect(errors[0]!.name).toBe("disagree");
    expect(errors[0]!.error.message).toContain('must match its folder');
  });
});
