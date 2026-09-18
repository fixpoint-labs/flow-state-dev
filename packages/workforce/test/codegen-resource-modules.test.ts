/**
 * Specs for Door B: the TypeScript in a `resources/` folder becomes a fourth
 * map on the generated module.
 *
 * Real temp directories through the real function, like the locked-folder specs
 * beside them — what a symlink does and what an unreadable folder does are
 * filesystem behaviours, and a mock would only restate the implementation.
 *
 * Two claims run through the whole file and are worth naming up front. The walk
 * never opens a module, so every fixture here is a file that could not be
 * loaded if anything tried. And the two doors have to agree: a module's ref is
 * the one a document of that name in that folder would get, and the folders
 * Door B descends into are the folders Door A descends into, which is asserted
 * against the Markdown reader itself rather than against a second list of
 * paths.
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
  type DiscoveredResourceModule,
} from "../src/codegen";
import { readResourcesDirectory } from "../src/loader";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A workforce root written from `{ "relative/path": contents }`. Directories are implied. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "fsd-door-b-"));
  roots.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

/** A module body that is a capability as far as the app's typecheck is concerned. Never loaded here. */
const MODULE = `export default {};`;

/** A document that Door A reads, for the fixtures where both doors are in play. */
const DOCUMENT = `---\ndescription: a document\n---\n\nbody`;

/** Every discovered module as its ref, marked when it sat in a worker's own folder. */
function found(modules: DiscoveredResourceModule[]): string[] {
  return modules.map((module) => (module.atWorkerRoot ? `${module.ref} (worker root)` : module.ref));
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

/** Walk a tree and render it — both halves, the pair `fsdev gen` runs. */
async function renderTree(root: string): Promise<string> {
  const result = await discoverWorkforceCode(root);
  return renderWorkforceCode(result.files, result.resourceModules);
}

describe("where the modules are found", () => {
  it("reads all four resources/ slots, under the refs a document would get", async () => {
    // The whole topology in one tree: the organisation's folder, an org
    // worker's own, a team's, and a team worker's own. A door that read only
    // the two roots the issue was cut against would leave a `.ts` file silent
    // in the one folder where the `.md` beside it works.
    const root = tree({
      "org/resources/atlas.ts": MODULE,
      "org/workers/registrar/resources/ledger.ts": MODULE,
      "teams/engineering/resources/research.ts": MODULE,
      "teams/engineering/workers/lead/resources/notes.ts": MODULE,
    });

    const { resourceModules } = await discoverWorkforceCode(root);

    // An org worker's ref drops `org/`, exactly as an org document's does.
    expect(found(resourceModules)).toEqual([
      "atlas",
      "workers/registrar/ledger (worker root)",
      "teams/engineering/research",
      "teams/engineering/workers/lead/notes (worker root)",
    ]);
  });

  it("mints the same refs the Markdown door mints, over the same tree shape", async () => {
    // Two claims in one assertion, and both are drift guards. The refs match,
    // so one ref has one owner and the collision check below can see a pair.
    // And *every* ref matches, so the two doors descended into the same
    // folders — a Door B that skipped a seat, or reached one Door A does not,
    // comes back with a different list. Asserted against the other door's own
    // output rather than against a list of strings this file wrote down: a
    // second spelling of the rule in a test is how the doors drift apart while
    // both suites stay green.
    const shape = (extension: string): Record<string, string> => ({
      [`org/resources/atlas${extension}`]: MODULE,
      [`org/workers/registrar/resources/ledger${extension}`]: MODULE,
      [`teams/engineering/resources/research${extension}`]: MODULE,
      [`teams/engineering/workers/lead/resources/notes${extension}`]: MODULE,
      [`teams/design/workers/ic/resources/palette${extension}`]: MODULE,
    });
    const asModules = tree(shape(".ts"));
    // Written separately because one basename cannot be both in one folder —
    // that pair is refused, which is the next block's subject.
    const asDocuments = tree(
      Object.fromEntries(Object.keys(shape(".md")).map((path) => [path, DOCUMENT])),
    );

    const { resourceModules } = await discoverWorkforceCode(asModules);
    const { documents, errors } = await readResourcesDirectory(asDocuments);

    expect(errors).toEqual([]);
    expect(documents).toHaveLength(5);
    expect(resourceModules.map((module) => module.ref).sort()).toEqual(
      documents.map((document) => document.ref).sort(),
    );
  });

  it("finds a .tsx module beside a .ts one", async () => {
    const root = tree({
      "teams/engineering/resources/research.ts": MODULE,
      "teams/engineering/resources/dashboard.tsx": MODULE,
    });

    const { resourceModules } = await discoverWorkforceCode(root);

    expect(found(resourceModules)).toEqual([
      "teams/engineering/dashboard",
      "teams/engineering/research",
    ]);
  });

  it("passes over everything in the folder that is not a module", async () => {
    // BR-5, proved beside a module that must still be found — a walk that
    // bailed on the first unrecognised entry fails here. The directory is the
    // load-bearing one: Door A reports it as an author's mistake, and Door B
    // refusing it too would make `fsdev gen` fail a build over a tree the
    // convention already tolerates and reports elsewhere.
    const root = tree({
      "teams/engineering/resources/handbook.md": DOCUMENT,
      "teams/engineering/resources/notes.txt": "not a declaration",
      "teams/engineering/resources/logo.png": "not a declaration either",
      "teams/engineering/resources/folder-where-a-file-belongs/RESOURCE.md": DOCUMENT,
      "teams/engineering/resources/research.ts": MODULE,
    });

    const { resourceModules } = await discoverWorkforceCode(root);

    expect(found(resourceModules)).toEqual(["teams/engineering/research"]);
  });

  it("generates nothing and says nothing for a tree with no resources at all", async () => {
    const root = tree({ "blocks/triage.ts": MODULE });

    const { resourceModules } = await discoverWorkforceCode(root);

    expect(resourceModules).toEqual([]);
  });

  it("orders modules by path, whatever order the tree was written in", async () => {
    // The file is committed, so it has to be diffable: a map that churns makes
    // every PR noisy and `--check` useless.
    const files = {
      "teams/engineering/resources/research.ts": MODULE,
      "org/resources/atlas.ts": MODULE,
      "teams/design/resources/palette.ts": MODULE,
    };
    const forwards = tree(files);
    const backwards = tree(Object.fromEntries(Object.entries(files).reverse()));

    expect(await renderTree(backwards)).toBe(await renderTree(forwards));
  });
});

describe("one ref, one owner", () => {
  it("refuses a document and a module sharing a basename, naming both files", async () => {
    // The failure this issue is about, at its sharpest: the two files mint ONE
    // ref between them, and whichever door ran last would have won in silence.
    const root = tree({
      "teams/engineering/resources/research.md": DOCUMENT,
      "teams/engineering/resources/research.ts": MODULE,
    });

    const problems = await refusalsOf(root);

    expect(problems).toEqual([
      `"teams/engineering/resources/research.ts" and ` +
        `"teams/engineering/resources/research.md" both declare ` +
        `"teams/engineering/research" — a document and a module cannot share a ref`,
    ]);
  });

  it("lets a document and a module of DIFFERENT names share a folder", async () => {
    // The negative control for the rule above. Without it the collision check
    // could refuse every folder holding both kinds of file and this suite
    // would not notice — which is the shape the convention is FOR.
    const root = tree({
      "teams/engineering/resources/handbook.md": DOCUMENT,
      "teams/engineering/resources/research.ts": MODULE,
    });

    const { resourceModules } = await discoverWorkforceCode(root);
    const { documents, errors } = await readResourcesDirectory(root);

    expect(found(resourceModules)).toEqual(["teams/engineering/research"]);
    expect(documents.map((document) => document.ref)).toEqual(["teams/engineering/handbook"]);
    expect(errors).toEqual([]);
  });

  it("refuses a .ts and a .tsx claiming one ref, naming both", async () => {
    const root = tree({
      "teams/engineering/resources/research.ts": MODULE,
      "teams/engineering/resources/research.tsx": MODULE,
    });

    const problems = await refusalsOf(root);

    expect(problems).toEqual([
      `"teams/engineering/resources/research.tsx" and ` +
        `"teams/engineering/resources/research.ts" both declare ` +
        `"teams/engineering/research" — one ref, one module`,
    ]);
  });

  it("does not confuse two teams' modules of the same name", async () => {
    // The whole reason a ref carries the folders above it.
    const root = tree({
      "teams/engineering/resources/handbook.ts": MODULE,
      "teams/design/resources/handbook.ts": MODULE,
    });

    const { resourceModules } = await discoverWorkforceCode(root);

    expect(found(resourceModules)).toEqual([
      "teams/design/handbook",
      "teams/engineering/handbook",
    ]);
  });
});

describe("what the walk refuses", () => {
  it("refuses a basename that is not a usable name, and generates nothing", async () => {
    const root = tree({
      "teams/engineering/resources/Research Notes.ts": MODULE,
      "teams/engineering/resources/research.ts": MODULE,
    });

    const problems = await refusalsOf(root);

    expect(problems).toEqual([
      `"teams/engineering/resources/Research Notes.ts" — Document file name ` +
        `"Research Notes" must be lowercase letters, digits, and single hyphens ` +
        `(not at the start or end) — it becomes part of the document's ref, which is joined with a "/"`,
    ]);
  });

  it("names every bad entry in one run, not the first", async () => {
    // An author fixing a tree should see the whole list once. Collected across
    // BOTH walks: a bad block file and a bad module are one run's worth of
    // work, and stopping at the first would cost a second round trip.
    const root = tree({
      "blocks/Triage Queue.ts": MODULE,
      "org/resources/Atlas.ts": MODULE,
      "teams/engineering/resources/_meta.ts": MODULE,
    });

    const problems = await refusalsOf(root);

    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("blocks/Triage Queue.ts");
    expect(problems[1]).toContain("org/resources/Atlas.ts");
    expect(problems[2]).toContain(`"_meta" is reserved`);
  });

  it("refuses a symlinked resources/ folder rather than walking what it points at", async () => {
    const outside = mkdtempSync(join(tmpdir(), "fsd-door-b-outside-"));
    roots.push(outside);
    writeFileSync(join(outside, "smuggled.ts"), MODULE);

    const root = tree({ "teams/engineering/.keep": "" });
    symlinkSync(outside, join(root, "teams/engineering/resources"));

    const problems = await refusalsOf(root);

    // Reported at the path, and the file behind the link is not in the result:
    // a followed link would put a module from outside the configured tree into
    // a committed file of static imports.
    expect(problems).toEqual([
      `Symlinked directory "teams/engineering/resources" — refused for safety`,
    ]);
  });

  it("refuses a symlinked module rather than importing through it", async () => {
    const outside = mkdtempSync(join(tmpdir(), "fsd-door-b-outside-"));
    roots.push(outside);
    const target = join(outside, "smuggled.ts");
    writeFileSync(target, MODULE);

    const root = tree({ "teams/engineering/resources/.keep": "" });
    symlinkSync(target, join(root, "teams/engineering/resources/research.ts"));

    const problems = await refusalsOf(root);

    expect(problems).toEqual([
      `Symlinked resource module "teams/engineering/resources/research.ts" — refused for safety`,
    ]);
  });

  it("refuses a symlinked worker folder rather than reading the seat behind it", async () => {
    const outside = mkdtempSync(join(tmpdir(), "fsd-door-b-outside-"));
    roots.push(outside);
    mkdirSync(join(outside, "resources"), { recursive: true });
    writeFileSync(join(outside, "resources/smuggled.ts"), MODULE);

    const root = tree({ "teams/engineering/workers/.keep": "" });
    symlinkSync(outside, join(root, "teams/engineering/workers/lead"));

    const problems = await refusalsOf(root);

    expect(problems).toEqual([
      `Symlinked worker folder "teams/engineering/workers/lead" — refused for safety`,
    ]);
  });

  it("refuses a resources/ folder that is present and unreadable, never folding it into absent", async () => {
    // The other half of BR-3, and the half a symlink test cannot reach.
    // Injected rather than provoked because the suite runs as root, where a
    // permission bit denies us nothing. The real route is a folder that exists
    // and whose `readdir` fails — a mode of `r--` rather than `r-x`.
    //
    // Absent and unreadable must stay apart: absent is a team with no
    // resources, unreadable is a team's resources we failed to see, and folding
    // them together generates a short module and reports nothing.
    const root = tree({
      "teams/engineering/resources/research.ts": MODULE,
      "teams/design/resources/palette.ts": MODULE,
    });
    const locked = join(root, "teams/engineering/resources");
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

    expect(problems).toEqual([
      `"teams/engineering/resources" could not be read: EACCES: permission denied, ` +
        `scandir '${locked}'`,
    ]);
  });

  it("refuses a worker folder that is present and unreadable", async () => {
    // The same distinction one level up, where a whole seat's resources are
    // behind the folder we cannot list.
    const root = tree({ "teams/engineering/workers/lead/resources/notes.ts": MODULE });
    const locked = join(root, "teams/engineering/workers/lead");
    const real = fsp.lstat.bind(fsp);
    vi.spyOn(fsp, "lstat").mockImplementation(((target: Parameters<typeof real>[0]) => {
      if (String(target) === locked) {
        const err = new Error(`EACCES: permission denied, lstat '${locked}'`);
        (err as NodeJS.ErrnoException).code = "EACCES";
        return Promise.reject(err);
      }
      return real(target);
    }) as unknown as typeof fsp.lstat);

    const problems = await refusalsOf(root);

    expect(problems).toEqual([
      `Worker folder "teams/engineering/workers/lead" could not be read: EACCES: ` +
        `permission denied, lstat '${locked}'`,
    ]);
  });

  it("refuses a directory named like a module", async () => {
    // The one directory in this folder Door B owns: it claims to be a module,
    // and the import it would be given resolves to nothing.
    const root = tree({ "teams/engineering/resources/research.ts/index.ts": MODULE });

    const problems = await refusalsOf(root);

    expect(problems).toEqual([
      `"teams/engineering/resources/research.ts" is a directory — a resource ` +
        `module is a file, one level deep in a resources/ folder`,
    ]);
  });
});

describe("a capability in one worker's own folder", () => {
  it("types a worker-scoped module so only a resource can satisfy it", async () => {
    // BR-21. Nothing in the walk can tell a capability from a resource without
    // opening the module, which discovery never does — so the refusal is the
    // type the generated entry carries, and the compile-time half of this claim
    // is in `resource-module-shapes.test-d.ts`. What is asserted here is that
    // the generator puts the narrower type on the worker-scoped entry and on
    // nothing else.
    const root = tree({
      "teams/engineering/resources/research.ts": MODULE,
      "teams/engineering/workers/lead/resources/notes.ts": MODULE,
    });

    const rendered = await renderTree(root);

    expect(rendered).toContain(
      `"teams/engineering/workers/lead/notes": resource_teams__engineering__workers__lead__notes ` +
        `satisfies WorkerResourceModuleExport,`,
    );
    expect(rendered).toContain(
      `"teams/engineering/research": resource_teams__engineering__research,`,
    );
    // The reason, in the file. TypeScript resolves the alias down to the
    // union's own name, so the compiler's own message reads as a shape
    // mismatch — this is the only place the rule can be stated where an author
    // reading the error will see it.
    expect(rendered).toContain(
      "// A worker's own `resources/` folder holds resources, not capabilities:",
    );
  });

  it("imports the worker-root type only when the tree actually has one", async () => {
    const root = tree({ "teams/engineering/resources/research.ts": MODULE });

    const rendered = await renderTree(root);

    // An app with no module at a worker root should not acquire an import, or
    // a paragraph of explanation, because of a rule its tree never meets.
    expect(rendered).toContain("ResourceModules");
    expect(rendered).not.toContain("WorkerResourceModuleExport");
    expect(rendered).not.toContain("holds resources, not capabilities");
  });
});

describe("the rendered map", () => {
  it("renders static imports and one entry per module, keyed by ref", async () => {
    const root = tree({
      "org/resources/atlas.ts": MODULE,
      "teams/engineering/resources/research-notes.ts": MODULE,
    });

    const rendered = await renderTree(root);

    // Static imports are why a bundled deploy behaves like a local one, and the
    // map's type is what makes the app's own typecheck read every module.
    expect(rendered).toContain(`import resource_atlas from "./org/resources/atlas";`);
    expect(rendered).toContain(
      `import resource_teams__engineering__research_notes from ` +
        `"./teams/engineering/resources/research-notes";`,
    );
    expect(rendered).toContain(`"atlas": resource_atlas,`);
    expect(rendered).toContain(`} satisfies ResourceModules;`);
    // Nothing dynamic: a lazy import here would put the walk back at run time.
    expect(rendered).not.toContain("import(");
  });

  it("gives two refs that differ only in a separator two different identifiers", async () => {
    // `a-b` in one folder and `b` in an `a` one are distinct refs, and the
    // binding each is imported under has to stay distinct too: two modules
    // sharing one binding emits a duplicate import that no bundler can
    // compile, in a file `fsdev gen` reported writing successfully.
    const root = tree({
      "teams/a-b/resources/c.ts": MODULE,
      "teams/a/resources/b-c.ts": MODULE,
      "org/resources/teams-a-b-c.ts": MODULE,
    });

    const rendered = await renderTree(root);

    const bindings = [...rendered.matchAll(/^import (\w+) from/gm)].map((match) => match[1]);
    expect(bindings).toHaveLength(3);
    expect(new Set(bindings).size).toBe(bindings.length);
  });

  it("renders an empty map with no type import when the tree has no modules", async () => {
    const root = tree({ "blocks/triage.ts": MODULE });

    const rendered = await renderTree(root);

    expect(rendered).toContain("export const resourceModules = {};");
    expect(rendered).not.toContain("ResourceModules");
  });
});
