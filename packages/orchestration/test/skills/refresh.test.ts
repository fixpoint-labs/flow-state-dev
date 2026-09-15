/**
 * Refreshing a catalog that already holds a copy.
 *
 * The half worth testing hard is the DELETING half. An overwrite-only refresh
 * passes every "the body changed" assertion and still leaves a supporting file
 * the source withdrew sitting in the folder, reachable through `prompt-ref` —
 * so the tests that matter here are the ones about what is gone, plus the
 * mirror-image one about `ensureSeeded` never deleting anything.
 */
import { describe, expect, it } from "vitest";
import type { InitialSkill } from "@flow-state-dev/core";
import { refreshSeededSkills } from "../../src/skills/refresh";
import { ensureSeeded } from "../../src/skills/seeding";
import { createMockSkillsCollection } from "./mocks";

const houseStyle = (body: string, files?: InitialSkill["files"]): InitialSkill => ({
  name: "house-style",
  skillMd: `---\ndescription: The house style\n---\n\n${body}`,
  ...(files ? { files } : {}),
});

const withTwoFiles = houseStyle("See reference/tone.md and reference/legacy.md.", [
  { path: "reference/tone.md", content: "# Tone" },
  { path: "reference/legacy.md", content: "# Legacy" },
]);

describe("refreshSeededSkills", () => {
  it("pulls a source body edit onto a catalog that already holds the skill", async () => {
    const c = createMockSkillsCollection();
    await ensureSeeded(c, [houseStyle("Write plainly.")]);
    expect(await c._store.get("skills/house-style/SKILL.md")!.content).toContain(
      "Write plainly.",
    );

    const result = await refreshSeededSkills(c, [houseStyle("Write very plainly.")]);

    expect(result.refreshed).toEqual(["house-style"]);
    expect(c._store.get("skills/house-style/SKILL.md")!.content).toContain(
      "Write very plainly.",
    );
  });

  // The defect the whole-folder rule exists to close: a file the source has
  // since dropped must not outlive the withdrawal. An overwrite-only refresh
  // leaves it, and it stays resolvable through `prompt-ref`.
  it("deletes a supporting file the source no longer carries", async () => {
    const c = createMockSkillsCollection();
    await ensureSeeded(c, [withTwoFiles]);
    expect(c._store.has("skills/house-style/reference/legacy.md")).toBe(true);

    const result = await refreshSeededSkills(c, [
      houseStyle("See reference/tone.md.", [{ path: "reference/tone.md", content: "# Tone" }]),
    ]);

    expect(c._store.has("skills/house-style/reference/legacy.md")).toBe(false);
    expect(c._store.has("skills/house-style/reference/tone.md")).toBe(true);
    expect(result.removed).toEqual(["house-style/reference/legacy.md"]);
  });

  // All-or-nothing per skill. The holder's own addition inside a refreshed
  // folder is lost, and that is signed off rather than incidental — a refresh
  // is the deliberate act where "the source wins" is the point.
  it("loses a local addition inside a folder it refreshes", async () => {
    const c = createMockSkillsCollection();
    await ensureSeeded(c, [houseStyle("Write plainly.")]);
    const own = await c.getOrCreate("house-style/notes.md");
    await own.writeContent("my own notes");
    expect(c._store.has("skills/house-style/notes.md")).toBe(true);

    await refreshSeededSkills(c, [houseStyle("Write plainly.")]);

    expect(c._store.has("skills/house-style/notes.md")).toBe(false);
  });

  it("leaves a deleted skill deleted", async () => {
    const c = createMockSkillsCollection();
    await ensureSeeded(c, [houseStyle("Write plainly.")]);
    await c.delete("house-style/SKILL.md");

    const result = await refreshSeededSkills(c, [houseStyle("Write very plainly.")]);

    expect(result.skipped).toEqual(["house-style"]);
    expect(result.refreshed).toEqual([]);
    expect(c._store.has("skills/house-style/SKILL.md")).toBe(false);
  });

  // Scoping: one skill's refresh must not reach into the collection's other
  // folders, nor `_meta` — which is what a `list()` that ignored its prefix
  // would do.
  it("touches only the folder it is refreshing", async () => {
    const other: InitialSkill = {
      name: "other",
      skillMd: "---\ndescription: Another skill\n---\n\nBody.",
      files: [{ path: "reference/keep.md", content: "# Keep" }],
    };
    const c = createMockSkillsCollection();
    await ensureSeeded(c, [withTwoFiles, other]);

    await refreshSeededSkills(c, [
      houseStyle("Shorter.", [{ path: "reference/tone.md", content: "# Tone" }]),
    ]);

    expect(c._store.has("skills/other/SKILL.md")).toBe(true);
    expect(c._store.has("skills/other/reference/keep.md")).toBe(true);
    expect(c._store.has("skills/_meta")).toBe(true);
  });

  it("skips a name the catalog never held, without seeding it", async () => {
    const c = createMockSkillsCollection();
    await ensureSeeded(c, [houseStyle("Write plainly.")]);

    const result = await refreshSeededSkills(c, [
      { name: "unseeded", skillMd: "---\ndescription: Never seeded here\n---\n\nBody." },
    ]);

    expect(result.skipped).toEqual(["unseeded"]);
    expect(c._store.has("skills/unseeded/SKILL.md")).toBe(false);
  });
});

// The other direction, and the reason refresh had to be its own call: an
// ORDINARY seeding pass is additive. A file inside a folder that the source
// never had is the holder's own edit, and deleting it on a routine pass is the
// propagation copy-in exists to refuse.
describe("ensureSeeded, against the refresh rule", () => {
  it("deletes nothing — not a withdrawn supporting file, not a local addition", async () => {
    const c = createMockSkillsCollection();
    await ensureSeeded(c, [withTwoFiles]);
    const own = await c.getOrCreate("house-style/notes.md");
    await own.writeContent("my own notes");

    // A fresh ref so the per-ref memo does not short-circuit the second pass,
    // carrying the persisted rows over as a new process would see them.
    const next = createMockSkillsCollection();
    for (const [k, v] of c._store) next._store.set(k, { ...v, state: { ...v.state } });

    await ensureSeeded(next, [
      houseStyle("See reference/tone.md.", [{ path: "reference/tone.md", content: "# Tone" }]),
    ]);

    expect(next._store.has("skills/house-style/reference/legacy.md")).toBe(true);
    expect(next._store.has("skills/house-style/notes.md")).toBe(true);
  });
});
