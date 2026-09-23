/**
 * The shared active-skill renderer, and what its `allowed-tools` note says.
 *
 * The renderer is the one place both skill entry points — the legacy
 * `createSkillsCapability` and `createSkillsLibrary`'s per-generator binding —
 * turn a manifest into prompt text. It is handed a collection, a name, a mount
 * path and an argument string, and nothing else: it has no way to learn which
 * tools the consuming generator actually registered. So the note it writes can
 * describe the skill's INTENT and must not describe the generator's ACCESS.
 *
 * That distinction is not cosmetic. On the question of what a generator may
 * CALL, `allowed-tools` decides nothing — `library.ts` validates the names
 * against the catalog and then contributes the whole catalog, or, under
 * `registerCatalogTools: false` (the stock worker posture), none of it. The
 * generator's own `tools:` is the boundary. (It is not inert everywhere: a
 * skill declaring `agents:` gates its delegation task seats with this list.
 * The note is silent on that, and so are these tests.)
 *
 * **These tests assert the note's complete text, not patterns it must avoid.**
 * An earlier draft asserted things like `not.toMatch(/tools are available/i)`,
 * which "only these tools are usable" would have satisfied — a check that
 * could not fail in the way it claimed to, on the PR whose whole argument is
 * that the wording is the deliverable. The wording lives in
 * `formatAllowedToolsIntentNote`, and that is what gets asserted.
 */
import { describe, expect, it } from "vitest";
import {
  formatAllowedToolsIntentNote,
  renderActiveSkillBody,
} from "../../src/skills/render-skill-body";
import { parseSkillMd } from "../../src/skills/skill-md";
import { createMockSkillsCollection } from "./mocks";

/**
 * Seed through the REAL frontmatter parser, the same one `seeding.ts` uses.
 * A hand-rolled regex here was bracket-only, so the spec's primary
 * space-separated form (`allowed-tools: board search`) seeded as though the
 * skill declared no tools at all — the note then never rendered and every
 * assertion below passed vacuously.
 */
async function seed(
  collection: ReturnType<typeof createMockSkillsCollection>,
  name: string,
  skillMd: string,
): Promise<void> {
  const { state } = parseSkillMd(skillMd, { expectedName: name });
  await collection.create(
    `${name}/SKILL.md`,
    { ...state, name, contextMode: state.contextMode ?? "inline" } as never,
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

const BODY = "Use the board tool when asked.";

// Both frontmatter forms `parseSkillMd` accepts. The space-separated one is
// the spec form per `skill-md.ts`; the bracket form is the documented
// leniency. Both must reach the note, or a test written in the other form is
// silently checking nothing.
const FORMS: ReadonlyArray<[label: string, frontmatter: string]> = [
  ["space-separated (the spec form)", "allowed-tools: board search"],
  ["bracket list", "allowed-tools: [board, search]"],
];

describe("renderActiveSkillBody — the `allowed-tools` note", () => {
  for (const [label, frontmatter] of FORMS) {
    describe(`declared as ${label}`, () => {
      const skillMd = `---\ndescription: Reads the board.\n${frontmatter}\n---\n\n${BODY}`;

      it("renders the note verbatim, naming the declared tools", async () => {
        const out = await render(skillMd);
        expect(out).toContain(formatAllowedToolsIntentNote(["board", "search"]));
      });

      it("renders the whole block exactly", async () => {
        const out = await render(skillMd);
        expect(out).toBe(
          `<active_skill name="uses-board">\n${BODY}\n` +
            `${formatAllowedToolsIntentNote(["board", "search"])}\n</active_skill>`,
        );
      });
    });
  }

  it("appends nothing when the skill declares no `allowed-tools`", async () => {
    const out = await render("---\ndescription: Plain.\n---\n\nJust do the thing.");
    expect(out).toBe('<active_skill name="uses-board">\nJust do the thing.\n</active_skill>');
  });
});

describe("formatAllowedToolsIntentNote — the wording is the deliverable", () => {
  const note = formatAllowedToolsIntentNote(["board", "search"]);

  it("is exactly this text", () => {
    expect(note).toBe(
      "(Tools this skill is written around: board, search. That is the skill's " +
        "intent, not a grant — whether this generator can call them is decided by " +
        "its own tool configuration, so some may be missing and others not listed " +
        "here may be present.)",
    );
  });

  // The renderer is shared with the legacy `createSkillsCapability`, which
  // attaches to an ordinary generator. "Seat" is workforce vocabulary and
  // would be undefined terminology in a model's prompt on that path.
  it("says `generator`, never `seat`", () => {
    expect(note).toContain("this generator");
    expect(note).not.toMatch(/\bseat\b/i);
  });
});
