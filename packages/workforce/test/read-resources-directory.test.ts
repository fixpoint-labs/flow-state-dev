/**
 * Specs for the resources convention loader: a Markdown file in a `resources/`
 * folder becomes one neutral document record.
 *
 * Same discipline as the worker reader's specs — every tree is a real temp
 * directory read through the real function, because the behaviours under test
 * (what a symlink does, what an unreadable folder does) are filesystem
 * behaviours. BP-035: each failing case sits in the same tree as a healthy
 * document, so a spec proves isolation and not just that the bad path errors.
 */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fsp from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readResourcesDirectory } from "../src/loader";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A tree written from `{ "relative/path": contents }`. Directories are implied. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "fsd-resources-"));
  roots.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

/** Create an empty directory inside an existing root. */
function dir(root: string, rel: string): string {
  const full = join(root, rel);
  mkdirSync(full, { recursive: true });
  return full;
}

const HANDBOOK = `---
description: How the engineering team works.
llmReadable: true
---

# Engineering handbook

Escalate anything customer-visible within 15 minutes.
`;

/** A healthy team document that must survive every failure spec in the same tree. */
const HEALTHY = { "teams/engineering/resources/handbook.md": HANDBOOK };

describe("readResourcesDirectory", () => {
  it("turns a team's Markdown file into a document carrying what the file declared", async () => {
    const { documents, errors } = await readResourcesDirectory(tree(HEALTHY));

    expect(errors).toEqual([]);
    expect(documents).toHaveLength(1);
    expect(documents[0]!.declared).toEqual({
      description: "How the engineering team works.",
      llmReadable: true,
    });
    expect(documents[0]!.body).toBe(
      "# Engineering handbook\n\nEscalate anything customer-visible within 15 minutes.\n",
    );
  });

  it("keys an org document by its bare name and a team's by its path", async () => {
    const { documents, errors } = await readResourcesDirectory(
      tree({
        "org/resources/code-of-conduct.md": HANDBOOK,
        "teams/engineering/resources/handbook.md": HANDBOOK,
        "teams/marketing/resources/handbook.md": HANDBOOK,
      }),
    );

    expect(errors).toEqual([]);
    expect(documents.map((d) => d.ref).sort()).toEqual([
      "code-of-conduct",
      "teams/engineering/handbook",
      "teams/marketing/handbook",
    ]);
  });

  it("reads a root that has only one of the two roots, and an empty root", async () => {
    const orgOnly = await readResourcesDirectory(tree({ "org/resources/coc.md": HANDBOOK }));
    expect(orgOnly.errors).toEqual([]);
    expect(orgOnly.documents.map((d) => d.ref)).toEqual(["coc"]);

    const empty = await readResourcesDirectory(tree({ "README.md": "not a tree" }));
    expect(empty.errors).toEqual([]);
    expect(empty.documents).toEqual([]);
  });

  it("throws only when the root itself cannot be read", async () => {
    await expect(
      readResourcesDirectory(join(tmpdir(), "fsd-resources-absent-root")),
    ).rejects.toThrow(/Failed to read/);
  });

  // R1 — the worker reader's error contract, on both resource roots. Each case
  // shares a tree with the healthy document, which must still load.
  describe("honours the worker reader's error contract", () => {
    it("reports a file with no frontmatter, under its own path", async () => {
      const root = tree({ ...HEALTHY, "org/resources/stray.md": "# Just a body\n" });
      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("org/resources/stray.md");
      expect(errors[0]!.kind).toBe("document-load-failed");
      expect(errors[0]!.error.message).toMatch(/no frontmatter/);
    });

    it("reports a file whose `description` is missing or empty", async () => {
      const root = tree({
        ...HEALTHY,
        "org/resources/no-desc.md": "---\nllmReadable: true\n---\n\nbody\n",
        "teams/engineering/resources/blank-desc.md": '---\ndescription: "   "\n---\n\nbody\n',
      });
      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors.map((e) => e.path).sort()).toEqual([
        "org/resources/no-desc.md",
        "teams/engineering/resources/blank-desc.md",
      ]);
      for (const entry of errors) {
        expect(entry.error.message).toMatch(/non-empty `description`/);
        expect(entry.kind).toBe("document-load-failed");
      }
    });

    it("reports a document file name that breaks the segment rules", async () => {
      const root = tree({ ...HEALTHY, "org/resources/Not Valid.md": HANDBOOK });
      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("org/resources/Not Valid.md");
      expect(errors[0]!.kind).toBe("document-load-failed");
      expect(errors[0]!.error.message).toMatch(/lowercase letters, digits, and single hyphens/);
    });

    it("reports a team folder name that breaks the segment rules", async () => {
      const root = tree({ ...HEALTHY, "teams/Engineering/resources/handbook.md": HANDBOOK });
      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/Engineering/resources/handbook.md");
      expect(errors[0]!.kind).toBe("document-load-failed");
      expect(errors[0]!.error.message).toMatch(/lowercase letters, digits, and single hyphens/);
    });

    it("refuses a symlinked document without following it", async () => {
      const root = tree({ ...HEALTHY, "outside/secret.md": HANDBOOK });
      dir(root, "org/resources");
      symlinkSync(join(root, "outside/secret.md"), join(root, "org/resources/linked.md"));

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("org/resources/linked.md");
      expect(errors[0]!.kind).toBe("document-load-failed");
      expect(errors[0]!.error.message).toMatch(/Symlinked/);
    });

    it("refuses a symlinked resources slot without following it", async () => {
      const root = tree({ ...HEALTHY, "outside/handbook.md": HANDBOOK });
      dir(root, "teams/marketing");
      symlinkSync(join(root, "outside"), join(root, "teams/marketing/resources"));

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing/resources");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/Symlinked/);
    });

    it("reports a structural folder that exists and cannot be listed, under its own path", async () => {
      // Only genuine absence may read as empty. Every other `readdir` failure
      // has to stay visible, or a whole team's documents drop out with the
      // caller's fatal-on-errors guard unable to see it. ENOTDIR stands in for
      // the class here because the suite runs as root, where a permission bit
      // would not deny us anything; EACCES takes the same branch.
      const { documents, errors } = await readResourcesDirectory(
        tree({ ...HEALTHY, "teams/marketing/resources": "not a directory\n" }),
      );

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing/resources");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/could not be read/i);
    });

    it("reports an unreadable document file rather than skipping it", async () => {
      const root = tree({ ...HEALTHY, "org/resources/locked.md": HANDBOOK });
      const locked = join(root, "org/resources/locked.md");
      const real = fsp.lstat.bind(fsp);
      vi.spyOn(fsp, "lstat").mockImplementation(((target: Parameters<typeof real>[0]) => {
        if (String(target) === locked) {
          const err = new Error(`EACCES: permission denied, lstat '${locked}'`);
          (err as NodeJS.ErrnoException).code = "EACCES";
          return Promise.reject(err);
        }
        return real(target);
      }) as unknown as typeof fsp.lstat);

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("org/resources/locked.md");
      expect(errors[0]!.kind).toBe("document-load-failed");
      expect(errors[0]!.error.message).toMatch(/could not be read/i);
    });

    it("ignores editor and OS droppings", async () => {
      const root = tree({ ...HEALTHY, "org/resources/.DS_Store": "junk" });
      const { documents, errors } = await readResourcesDirectory(root);

      expect(errors).toEqual([]);
      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
    });
  });

  // R2 — the two consequences of Decision 1 (a resource is a file, not a
  // folder). The inversion of the worker reader's skip rule is the point.
  describe("the file-not-folder shape", () => {
    it("reports a directory in a resources slot, naming the file convention", async () => {
      const root = tree({
        ...HEALTHY,
        "teams/marketing/resources/handbook/RESOURCE.md": HANDBOOK,
      });

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing/resources/handbook");
      expect(errors[0]!.kind).toBe("folder-where-file-belongs");
      // The author who made this mistake arrived from `workers/`; the message
      // has to tell them the shape, not just that something went wrong.
      expect(errors[0]!.error.message).toContain("handbook.md");
      expect(errors[0]!.error.message).toMatch(/file, not a folder/i);
    });

    it("skips a non-`.md` file in silence", async () => {
      const root = tree({
        ...HEALTHY,
        "teams/engineering/resources/notes.txt": "scratch",
        "teams/engineering/resources/diagram.png": "PNG",
      });

      const { documents, errors } = await readResourcesDirectory(root);

      expect(errors).toEqual([]);
      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
    });
  });

  // R4, reader door — every field the convention derives is refused by name.
  // These are the regressions for F1a-F1c: each of these keys, carried
  // verbatim, could redirect a storage row or replace the document body.
  describe("refuses every field the convention derives", () => {
    const derived: Array<[string, string]> = [
      ["scope", "scope: user"],
      ["ref", "ref: somewhere-else"],
      ["stateSchema", "stateSchema: not-a-schema"],
      ["default", "default: {}"],
      ["content", "content: hijacked"],
      ["contentFile", "contentFile: ./other.md"],
      ["contentTemplate", "contentTemplate: ./other.liquid"],
      ["contentTemplateRef", "contentTemplateRef: other"],
    ];

    it.each(derived)("reports a file declaring `%s` under its own path", async (key, line) => {
      const root = tree({
        ...HEALTHY,
        "org/resources/overreach.md":
          `---\ndescription: Tries to declare what the convention derives.\n${line}\n---\n\nbody\n`,
      });

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("org/resources/overreach.md");
      expect(errors[0]!.kind).toBe("refused-declaration");
      expect(errors[0]!.error.message).toContain("overreach.md");
      expect(errors[0]!.error.message).toContain(`\`${key}:\``);
    });

    it("refuses a lazy prefetchMode with the reason, because defineFlow would reject the flow", async () => {
      const root = tree({
        ...HEALTHY,
        "org/resources/lazy.md":
          "---\ndescription: Wants to be loaded on demand.\nprefetchMode: lazy\n---\n\nbody\n",
      });

      const { documents, errors } = await readResourcesDirectory(root);

      expect(documents.map((d) => d.ref)).toEqual(["teams/engineering/handbook"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("org/resources/lazy.md");
      expect(errors[0]!.kind).toBe("refused-declaration");
      expect(errors[0]!.error.message).toMatch(/prefetchMode/);
      expect(errors[0]!.error.message).toMatch(/flow level/);
    });

    it("carries an eager prefetchMode verbatim — only lazy is refused", async () => {
      const root = tree({
        "org/resources/eager.md":
          "---\ndescription: Loaded up front, which is the default anyway.\nprefetchMode: eager\n---\n\nbody\n",
      });

      const { documents, errors } = await readResourcesDirectory(root);

      expect(errors).toEqual([]);
      expect(documents[0]!.declared["prefetchMode"]).toBe("eager");
    });

    it("carries every key outside the derived set verbatim", async () => {
      const root = tree({
        "org/resources/rich.md": `---
description: Everything the convention does not own arrives unchanged.
llmReadable: true
llmWritable: false
writable: true
allowedExtensions: [md, txt]
metadata:
  owner: platform
somethingNobodyHasClaimedYet: 7
---

body
`,
      });

      const { documents, errors } = await readResourcesDirectory(root);

      expect(errors).toEqual([]);
      expect(documents[0]!.declared).toEqual({
        description: "Everything the convention does not own arrives unchanged.",
        llmReadable: true,
        llmWritable: false,
        writable: true,
        allowedExtensions: ["md", "txt"],
        metadata: { owner: "platform" },
        somethingNobodyHasClaimedYet: 7,
      });
    });
  });
});
