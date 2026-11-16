/**
 * The lab's inventory: what the app is made of, read off its files. The lab
 * is configuration, screens and a few small flows; what the server computes
 * reaches a screen only through a kit package's view or a direct read, in
 * `src/lab.ts`. Each rule fails on the shape it forbids:
 *
 * - no adapter (`src/adapter.ts`), no fake lab (`test/fake-lab.ts`), and no
 *   `LabAdapter` seam anywhere in the lab;
 * - nothing of the app's in `workforce/`: that folder holds the `WORKER.md`
 *   tree the workforce kit reads, and no code;
 * - no screen file reaches the server itself: only `src/lab.ts` imports a
 *   value from `@flow-state-dev/client`, the entry imports only
 *   `createClient`, and no other file calls `.subscribe(` or `.flow(`;
 * - every exported object type in a `src/` module that is not a component
 *   is on {@link SCREEN_TYPES}, the types the screen computes itself; a row a
 *   view returns takes its type from the view.
 *
 * The project concept is the one rule not met yet: the picker still lists
 * workforce projects until FIX-2594's dialog lists repositories. It is an
 * `it.fails`, green while the lab still imports the concept, red the day it
 * stops, and that PR makes it an `it`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LAB = fileURLToPath(new URL("..", import.meta.url));

/** Every file under `dir` of the lab, by its path from the lab, skipping what a build or install writes. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const name of readdirSync(abs)) {
      if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
      const path = join(abs, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(LAB, path));
    }
  };
  if (existsSync(join(LAB, dir))) walk(join(LAB, dir));
  return out;
}

const read = (rel: string) => readFileSync(join(LAB, rel), "utf8");
const code = (rel: string) => /\.(m?ts|tsx)$/.test(rel);

/** The lab's own code: its screens, flows, host and CLI, not its tests. */
const APP_CODE = [...filesUnder("src"), ...filesUnder("flows"), ...filesUnder("cli"), "host.mts", "fsdev.config.mts"].filter(code);

/** The one module that reads and writes for the screen. */
const READS = "src/lab.ts";
/** The entry: it builds the one client. */
const ENTRY = "src/main.tsx";

/**
 * The types the screen computes itself, by the module that exports them: a
 * view's row in the screen's fields with what the screen adds (`LabSession`,
 * `LabTask`), what a hook hands back assembled from several reads
 * (`ThreadView`, `TaskWork`, `WorkingNow`), the calls' own shapes, and the
 * thread's entries drawn from stored items.
 */
const SCREEN_TYPES: Record<string, readonly string[]> = {
  "src/lab.ts": ["LabSession", "LabProject", "ConnectionState", "ThreadView", "LabTask", "TaskBoardCalls", "TaskWork", "WorkingNow", "LabHarness", "RepositoryCheck", "LabConnection", "LabCalls"],
  "src/lib/address.ts": ["Address"],
  "src/lib/thread-entries.ts": ["ThreadEntry", "Item"],
  "src/lib/tool-steps.ts": ["ToolCallOf", "ToolStep", "ToolRun"],
  "src/modes.ts": ["Mode"],
};

/** The workforce identifiers of its project concept the lab may not import once a session works in a repository. */
const PROJECT_CONCEPT = ["parseProjectRef", "projectRef", "PROJECTS_PATTERN", "WORK_PROJECT_STATE_KEY", "CreateProjectOutput", "projectSourceCapability", "projectWorkspace", "defineProjectBlocks", "projectChecks"];

/** The value imports a file makes from `pkg`: each name not marked `type`, in an import that isn't `import type`. */
function valueImports(text: string, pkg: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
    if (m[1] !== undefined || m[3] !== pkg) continue;
    for (const raw of m[2]!.split(",")) {
      const name = raw.trim();
      if (name !== "" && !name.startsWith("type ")) out.push(name.split(/\s+as\s+/)[0]!);
    }
  }
  // Any other form (a namespace, a default or a dynamic import) can't be read name by name: name it as such.
  for (const m of text.matchAll(new RegExp(`(import\\s+\\*\\s+as\\s+\\w+|import\\s+\\w+|import\\()\\s*(from\\s*)?["']${pkg.replace("/", "\\/")}["']`, "g"))) out.push(m[1]!);
  return out;
}

describe("the lab's inventory", () => {
  it("has no adapter, no fake lab and no LabAdapter seam", () => {
    expect(existsSync(join(LAB, "src/adapter.ts"))).toBe(false);
    expect(existsSync(join(LAB, "test/fake-lab.ts"))).toBe(false);
    const seam = [...APP_CODE, ...filesUnder("test").filter(code)].filter((rel) => rel !== "test/inventory.test.ts" && read(rel).includes("LabAdapter"));
    expect(seam).toEqual([]);
  });

  it("keeps nothing of the app's in workforce/: only the WORKER.md tree", () => {
    expect(filesUnder("workforce").filter((rel) => !rel.endsWith(".md"))).toEqual([]);
  });

  it("reaches the server from src/lab.ts alone: no other file imports a client value, subscribes or names a flow", () => {
    const reaching = APP_CODE.filter((rel) => rel.startsWith("src/") && rel !== READS).flatMap((rel) => {
      // Code, not what its comments say about a client.
      const text = read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      const values = valueImports(text, "@flow-state-dev/client").filter((name) => !(rel === ENTRY && name === "createClient"));
      return [...values.map((name) => `${rel}: imports ${name}`), ...(/\.subscribe\(/.test(text) ? [`${rel}: .subscribe(`] : []), ...(/\.flow\(/.test(text) ? [`${rel}: .flow(`] : [])];
    });
    expect(reaching).toEqual([]);
  });

  it("types no row a view returns by hand: every exported object type outside the components is one the screen computes", () => {
    const modules = filesUnder("src").filter((rel) => /\.tsx?$/.test(rel) && !rel.startsWith("src/components/") && rel !== ENTRY && rel !== "src/App.tsx");
    const unlisted = modules.flatMap((rel) =>
      [...read(rel).matchAll(/^export\s+(?:interface\s+(\w+)|type\s+(\w+)(?:<[^>]*>)?\s*=\s*(.*))$/gm)]
        // A union of string literals names no row: only an object type can be one.
        .filter((m) => m[1] !== undefined || !/^("[^"]*"\s*\|?\s*)+;?$/.test(m[3]!.trim()))
        .map((m) => m[1] ?? m[2]!)
        .filter((name) => !(SCREEN_TYPES[rel] ?? []).includes(name))
        .map((name) => `${rel}: ${name}`),
    );
    expect(unlisted).toEqual([]);
  });

  // FIX-2594: the picker lists repositories, not workforce projects.
  it.fails("imports none of workforce's project concept", () => {
    const imports = APP_CODE.flatMap((rel) => {
      const text = read(rel);
      return PROJECT_CONCEPT.filter((name) => new RegExp(`\\b${name}\\b`).test(text)).map((name) => `${rel}: ${name}`);
    });
    expect(imports).toEqual([]);
  });
});
