/**
 * The shared active-skill renderer, and what its `allowed-tools` note is
 * allowed to claim (FIX-1451).
 *
 * The renderer is the one place both skill entry points — the legacy
 * `createSkillsCapability` and `createSkillsLibrary`'s per-generator binding —
 * turn a manifest into prompt text. It is handed a collection, a name, a mount
 * path and an argument string, and nothing else: it has no way to learn which
 * tools the consuming generator actually registered. So the note it writes can
 * describe the skill's INTENT and must not describe the seat's ACCESS.
 *
 * That distinction is not cosmetic. `allowed-tools` grants nothing anywhere in
 * the framework — `library.ts` validates the names against the catalog and,
 * under `registerCatalogTools: false` (the stock worker posture), registers
 * none of them. A seat's own `tools:` is the whole grant.
 */
import { describe, expect, it } from "vitest";
import { renderActiveSkillBody } from "../../src/skills/render-skill-body";
import { createMockSkillsCollection } from "./mocks";

async function seed(
  collection: ReturnType<typeof createMockSkillsCollection>,
  name: string,
  skillMd: string,
): Promise<void> {
  const frontmatter = skillMd.split("---")[1] ?? "";
  const allowedTools = /allowed-tools:\s*\[([^\]]*)\]/.exec(frontmatter)?.[1];
  await collection.create(
    `${name}/SKILL.md`,
    {
      name,
      description: "A skill.",
      contextMode: "inline",
      ...(allowedTools
        ? { allowedTools: allowedTools.split(",").map((t) => t.trim()) }
        : {}),
    } as never,
    { replace: true },
  );
  const ref = collection.getOptional(`${name}/SKILL.md`);
  await ref!.writeContent(skillMd);
}

async function render(skillMd: string): Promise<string> {
  const collection = createMockSkillsCollection();
  await seed(collection, "uses-board", skillMd);
  const out = await renderActiveSkillBody(collection, "uses-board", "skills", undefined);
  expect(out).not.toBeNull();
  return out!;
}

const WITH_TOOLS =
  "---\ndescription: Reads the board.\nallowed-tools: [board, search]\n---\n\nUse the board tool when asked.";

describe("renderActiveSkillBody — the `allowed-tools` note", () => {
  it("names the tools the skill declares, so the author's intent still reaches the model", async () => {
    const out = await render(WITH_TOOLS);
    expect(out).toContain("board");
    expect(out).toContain("search");
  });

  it("makes no claim about what the generator can call", async () => {
    const out = await render(WITH_TOOLS);
    // The renderer cannot know the answer, so every phrasing of the question
    // is out. "only these tools are available" was the shipped one.
    expect(out).not.toMatch(/tools are available/i);
    expect(out).not.toMatch(/you (can|may) call/i);
    expect(out).not.toMatch(/access to/i);
    expect(out).not.toMatch(/\bgranted\b/i);
  });

  it("says the list is the skill's intent and not a grant", async () => {
    const out = await render(WITH_TOOLS);
    expect(out).toMatch(/not a grant/i);
  });

  it("appends nothing when the skill declares no `allowed-tools`", async () => {
    const out = await render("---\ndescription: Plain.\n---\n\nJust do the thing.");
    expect(out).not.toMatch(/not a grant/i);
    expect(out).toBe('<active_skill name="uses-board">\nJust do the thing.\n</active_skill>');
  });
});
