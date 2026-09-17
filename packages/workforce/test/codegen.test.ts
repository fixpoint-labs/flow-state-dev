/**
 * Specs for the code convention: the three locked folders become one module.
 *
 * Same discipline as the loader's specs — every tree is a real temp directory
 * read through the real function, because what a symlink does and what an
 * unreadable folder does are filesystem behaviours and a mock would only
 * restate the implementation.
 *
 * The first block is the one that matters most: the generator reads the tree
 * and never loads the modules in it. That is the decision this convention rests
 * on, so it is pinned by a tree whose files cannot be loaded at all.
 */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fsp from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkforceCodeError,
  discoverWorkforceCode,
  renderWorkforceCode,
  type DiscoveredFile,
} from "../src/codegen";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A workforce root written from `{ "relative/path": contents }`. Directories are implied. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "fsd-codegen-"));
  roots.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

/** Every discovered file as `slot:name`, for a readable assertion. */
function found(files: DiscoveredFile[]): string[] {
  return files.map((file) => `${file.slot}:${file.name}`);
}

/** Collect the refusal messages from a walk that should have refused. */
async function refusalsOf(root: string): Promise<string[]> {
  try {
    await discoverWorkforceCode(root);
  } catch (error) {
    expect(error).toBeInstanceOf(WorkforceCodeError);
    return (error as WorkforceCodeError).problems;
  }
  throw new Error("expected the walk to refuse, and it did not");
}

describe("the generator reads the tree, never the modules in it", () => {
  it("generates for files that could not possibly be loaded", async () => {
    // Every file here imports a bare specifier that resolves nowhere, and one
    // is not even syntactically valid TypeScript. A generator that opened them
    // — to read a declared `kind`, or to check an export's shape — would throw
    // on all three. Getting a rendered module back is the proof it did not.
    const root = tree({
      "flows/workers/researcher.ts": `import x from "@nope/does-not-exist"; export default x;`,
      "flows/channels/standup.ts": `import { y } from "not-a-package-either"; export default y;`,
      "blocks/triage.ts": `this is not valid TypeScript at all ((((`,
    });

    const result = await discoverWorkforceCode(root);

    expect(found(result.files)).toEqual(["block:triage", "channel:standup", "worker:researcher"]);
    expect(renderWorkforceCode(result.files)).toContain(`"researcher": workerResearcher`);
  });
});

describe("what the walk finds", () => {
  it("registers a worker kind, a channel kind and a block under their basenames", async () => {
    const root = tree({
      "flows/workers/researcher.ts": "export default {};",
      "flows/channels/standup.ts": "export default {};",
      "blocks/triage.ts": "export default {};",
    });

    const { files } = await discoverWorkforceCode(root);

    // Slot, name and import path together: a file landing on the wrong map
    // would hand `hireWorkforce` a channel kind, which the registry refuses.
    expect(files).toEqual([
      { slot: "block", name: "triage", path: "blocks/triage.ts", importPath: "./blocks/triage" },
      {
        slot: "channel",
        name: "standup",
        path: "flows/channels/standup.ts",
        importPath: "./flows/channels/standup",
      },
      {
        slot: "worker",
        name: "researcher",
        path: "flows/workers/researcher.ts",
        importPath: "./flows/workers/researcher",
      },
    ]);
  });

  it("generates empty maps when none of the folders exists", async () => {
    const root = tree({ "teams/engineering/workers/lead/WORKER.md": "# lead" });

    const { files, searched } = await discoverWorkforceCode(root);

    // Not an error: an app with no custom code is an ordinary app. And the
    // command can still say where it looked.
    expect(files).toEqual([]);
    expect(searched).toEqual(["flows/workers", "flows/channels", "blocks"]);
  });

  it("generates empty maps for a folder holding nothing it recognises", async () => {
    const root = tree({ "flows/workers/README.md": "notes about the kinds that will live here" });

    const { files } = await discoverWorkforceCode(root);

    expect(files).toEqual([]);
  });

  it("skips a file that is not TypeScript and keeps its healthy neighbour", async () => {
    const root = tree({
      "blocks/README.md": "# blocks",
      "blocks/fixture.json": "{}",
      "blocks/triage.ts": "export default {};",
    });

    const { files } = await discoverWorkforceCode(root);

    // BP-035: the skip is proved beside a file that must still be found, so a
    // walk that bailed on the first unrecognised entry fails here.
    expect(found(files)).toEqual(["block:triage"]);
  });

  it("refuses a directory inside a locked folder rather than skipping it", async () => {
    const root = tree({
      "flows/workers/researcher.ts": "export default {};",
      "flows/workers/grouped/nested.ts": "export default {};",
    });

    const problems = await refusalsOf(root);

    // A folder an author created and the tool ignored is exactly the silence
    // this convention exists to remove, so it refuses by name.
    expect(problems).toEqual([
      expect.stringContaining('"flows/workers/grouped" is a directory'),
    ]);
  });

  it("does not follow a symlinked entry, in the wording the shipped readers use", async () => {
    const root = tree({
      "blocks/triage.ts": "export default {};",
      "elsewhere/secret.ts": "export default {};",
    });
    symlinkSync(join(root, "elsewhere/secret.ts"), join(root, "blocks/linked.ts"));

    const problems = await refusalsOf(root);

    expect(problems).toEqual(['Symlinked entry "blocks/linked.ts" — refused for safety']);
  });
});

describe("what the walk refuses", () => {
  it("refuses a basename that is not a legal segment, naming the file and the rule", async () => {
    const root = tree({
      "flows/workers/Researcher.ts": "export default {};",
      "blocks/my_block.ts": "export default {};",
    });

    const problems = await refusalsOf(root);

    // The basename becomes a kind name and part of a flow instance id, so it
    // obeys the rule every other segment in this tree obeys.
    expect(problems).toEqual([
      expect.stringContaining('"flows/workers/Researcher.ts"'),
      expect.stringContaining('"blocks/my_block.ts"'),
    ]);
    expect(problems[0]).toContain("lowercase letters, digits, and single hyphens");
  });

  it("refuses one basename claimed by both flow folders", async () => {
    const root = tree({
      "flows/workers/standup.ts": "export default {};",
      "flows/channels/standup.ts": "export default {};",
    });

    const problems = await refusalsOf(root);

    expect(problems).toEqual([
      expect.stringContaining('"flows/channels/standup.ts" and "flows/workers/standup.ts"'),
    ]);
  });

  it("lets a block and a worker kind share a basename", async () => {
    const root = tree({
      "flows/workers/triage.ts": "export default {};",
      "blocks/triage.ts": "export default {};",
    });

    const { files } = await discoverWorkforceCode(root);

    // They feed different maps on different calls, so nothing downstream can
    // collide. Refusing this would be a rule with no case behind it.
    expect(found(files)).toEqual(["block:triage", "worker:triage"]);
  });

  it("refuses a locked folder that is present and unreadable, never folding it into absent", async () => {
    // Injected rather than provoked because the suite runs as root, where a
    // permission bit denies us nothing. The real route is a folder that exists
    // and whose `readdir` fails — a mode of `r--` rather than `r-x`.
    const root = tree({
      "flows/workers/researcher.ts": "export default {};",
      "blocks/triage.ts": "export default {};",
    });
    const locked = join(root, "blocks");
    const real = fsp.readdir.bind(fsp);
    vi.spyOn(fsp, "readdir").mockImplementation(((target: Parameters<typeof real>[0]) => {
      if (String(target) === locked) {
        const err = new Error(`EACCES: permission denied, scandir '${locked}'`);
        (err as NodeJS.ErrnoException).code = "EACCES";
        return Promise.reject(err);
      }
      return real(target);
    }) as unknown as typeof fsp.readdir);

    const problems = await refusalsOf(root);

    // Absent means no custom code; unreadable means code we failed to see.
    // Reading the second as the first would generate a registry quietly short —
    // the one thing a committed file and a `--check` gate cannot catch.
    expect(problems).toEqual([expect.stringContaining('"blocks" could not be read')]);
  });

  it("reports every problem in one run and renders nothing", async () => {
    const root = tree({
      "flows/workers/Bad.ts": "export default {};",
      "flows/workers/also.bad.ts": "export default {};",
      "blocks/grouped/nested.ts": "export default {};",
      "blocks/fine.ts": "export default {};",
    });

    const problems = await refusalsOf(root);

    // An author fixing a tree sees the whole list, the way a bad roster does.
    // A walk that threw where it found the first would report one.
    expect(problems).toHaveLength(3);
  });
});

describe("staying in step", () => {
  it("renders byte-identically however the directory listed", async () => {
    const files: Record<string, string> = {
      "flows/workers/analyst.ts": "export default {};",
      "flows/workers/researcher.ts": "export default {};",
      "flows/channels/standup.ts": "export default {};",
      "blocks/triage.ts": "export default {};",
    };
    const forwards = tree(files);
    const backwards = tree(Object.fromEntries(Object.entries(files).reverse()));

    const first = renderWorkforceCode((await discoverWorkforceCode(forwards)).files);
    const second = renderWorkforceCode((await discoverWorkforceCode(forwards)).files);
    const shuffled = renderWorkforceCode((await discoverWorkforceCode(backwards)).files);

    // The file is committed. One that churns makes every PR noisy and makes
    // `--check` useless, so ordering is by path and never by creation order.
    expect(second).toBe(first);
    expect(shuffled).toBe(first);

    // Determinism alone would also hold for an order that happened to be
    // stable, so the order itself is pinned: by path, which is the one key a
    // directory listing cannot move.
    const imported = [...first.matchAll(/^import \w+ from "(.+)";$/gm)].map((match) => match[1]);
    expect(imported).toEqual([
      "./blocks/triage",
      "./flows/channels/standup",
      "./flows/workers/analyst",
      "./flows/workers/researcher",
    ]);
  });
});

describe("the rendered module", () => {
  it("imports every file statically and types each map as the parameter it feeds", async () => {
    const root = tree({
      "flows/workers/code-reviewer.ts": "export default {};",
      "flows/channels/standup.ts": "export default {};",
      "blocks/triage.ts": "export default {};",
    });

    const rendered = renderWorkforceCode((await discoverWorkforceCode(root)).files);

    // Static imports are why a bundled deploy behaves like a local one, and the
    // types are what make the app's own typecheck read every discovered file.
    expect(rendered).toContain(`import workerCodeReviewer from "./flows/workers/code-reviewer";`);
    expect(rendered).toContain(`"code-reviewer": workerCodeReviewer`);
    expect(rendered).toContain(`satisfies NonNullable<HireOptions["kinds"]>`);
    expect(rendered).toContain(`satisfies NonNullable<ChannelInstancesOptions["kinds"]>`);
    expect(rendered).toContain(`satisfies Record<string, BlockDefinition>`);
    expect(rendered).toContain("Do not edit");
    // Nothing dynamic: a lazy import here would put the walk back at run time.
    expect(rendered).not.toContain("import(");
  });

  it("renders an empty map with no type import when a folder holds nothing", async () => {
    const root = tree({ "blocks/triage.ts": "export default {};" });

    const rendered = renderWorkforceCode((await discoverWorkforceCode(root)).files);

    // An app with no custom kinds should not acquire an import because of a
    // folder it does not have — and there is no member for a type to catch.
    expect(rendered).toContain("export const kinds = {};");
    expect(rendered).toContain("export const channelKinds = {};");
    expect(rendered).not.toContain("HireOptions");
  });
});
