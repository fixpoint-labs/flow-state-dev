/**
 * The lab's inventory rules, read off its files: each answers the findings
 * for one rule, an empty list when the lab meets it. `inventory.test.ts` runs
 * them on every `pnpm test`, and the epic's closure goal
 * (`goals/kits/an-app-is-config-ui-and-small-flows/`) grades the same rules
 * on the lab, so the lab has one inventory, not two.
 *
 * The kinds of code are FIX-2152 ER-1's, by path, with one change: the small
 * flows live in the app kit's folder, `flows/`, beside `workforce/`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** The lab's own folder. */
export const LAB = fileURLToPath(new URL("..", import.meta.url));

/** The one module the screen reads and writes through. */
export const READS = "src/lab.ts";
/** The entry: it builds the one client. */
export const ENTRY = "src/main.tsx";

/** ER-1's caps: at most this many flows, each under this many lines, and this many lines of configuration in all. */
export const CAPS = { flows: 3, flowLines: 200, configLines: 300 } as const;

/**
 * The types the screen computes itself, by the module that exports them: a
 * view's row in the screen's fields with what the screen adds (`LabSession`,
 * `LabTask`), what a hook hands back assembled from several reads
 * (`ThreadView`, `TaskWork`, `WorkingNow`), the calls' own shapes, and the
 * thread's entries drawn from stored items. A new one goes on the list in a
 * reviewed PR.
 */
export const SCREEN_TYPES: Record<string, readonly string[]> = {
  "src/lab.ts": ["LabSession", "LabProject", "ConnectionState", "ThreadView", "LabTask", "TaskBoardCalls", "TaskWork", "WorkingNow", "LabHarness", "RepositoryCheck", "LabConnection", "LabCalls"],
  "src/lib/address.ts": ["Address"],
  "src/lib/thread-entries.ts": ["ThreadEntry", "Item"],
  "src/lib/tool-steps.ts": ["ToolCallOf", "ToolStep", "ToolRun"],
  "src/modes.ts": ["Mode"],
};

/** A file of the lab, by its path from the lab, and the kind of code it is. */
export type Kind = "config" | "flow" | "ui" | "outside" | "other";

/** What an install or a build writes: the lab's `.gitignore`. */
const BUILT = new Set(["node_modules", "dist", "dist-client"]);

/** Every file under `dir` of `lab`, by its path from the lab, skipping what a build or install writes. */
export function filesUnder(dir: string, lab = LAB): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const name of readdirSync(abs)) {
      if (BUILT.has(name) || name.startsWith(".")) continue;
      const path = join(abs, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(lab, path));
    }
  };
  if (existsSync(join(lab, dir))) walk(join(lab, dir));
  return out;
}

const OUTSIDE = [/^README\.md$/, /^package\.json$/, /^tsconfig\.json$/, /^vite\.config\.ts$/, /^index\.html$/, /^test\//,
  // Tooling ER-1 doesn't name, counted outside with it: no logic.
  /^components\.json$/, /^vitest(\.[a-z]+)?\.config\.ts$/, /^cli\/index\.ts$/];

/** The kind of code the file at `rel` is, by its path alone (ER-1). */
export function kindOf(rel: string): Kind {
  if (OUTSIDE.some((r) => r.test(rel))) return "outside";
  if (rel === "fsdev.config.mts" || rel === "host.mts" || /^workforce\/.*\.md$/.test(rel)) return "config";
  if (/^flows\/[^/]+\.mts$/.test(rel)) return "flow";
  if (/^src\/.*\.(tsx|ts|css)$/.test(rel)) return "ui";
  return "other";
}

const linesOf = (abs: string) => (readFileSync(abs, "utf8").match(/\n/g) ?? []).length;
const isCode = (rel: string) => /\.(m?ts|tsx)$/.test(rel);
/** A file's code, without what its comments say about it. */
const codeOf = (abs: string) =>
  readFileSync(abs, "utf8")
    // A block comment keeps its line breaks, so a finding's line number is the file's.
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ""))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** The value imports `text` makes from `pkg`: each name not marked `type`, plus any namespace, default, dynamic or re-export form. */
export function valueImports(text: string, pkg: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(import|export)\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
    if (m[2] !== undefined || m[4] !== pkg) continue;
    for (const raw of m[3]!.split(",")) {
      const name = raw.trim();
      if (name !== "" && !name.startsWith("type ")) out.push(m[1] === "export" ? `re-export ${name}` : name.split(/\s+as\s+/)[0]!);
    }
  }
  // Any other form can't be read name by name: name it as such.
  const escaped = pkg.replace(/[/.]/g, "\\$&");
  for (const m of text.matchAll(new RegExp(`(import\\s+\\*\\s+as\\s+\\w+|import\\s+\\w+|import\\(|export\\s+\\*)\\s*(from\\s*)?["']${escaped}["']`, "g"))) out.push(m[1]!);
  return out;
}

/** L1: every file of the lab is configuration, UI, a small flow, or outside the count. */
export function unclassified(lab = LAB): string[] {
  return filesUnder("", lab).filter((rel) => kindOf(rel) === "other").map((rel) => `${rel}: not configuration, UI, a small flow or outside the count`);
}

/** L2: the flows and the configuration within ER-1's caps. */
export function overCaps(lab = LAB): string[] {
  const files = filesUnder("", lab);
  const flows = files.filter((rel) => kindOf(rel) === "flow");
  const found: string[] = [];
  if (flows.length > CAPS.flows) found.push(`${flows.length} flows, cap ${CAPS.flows}`);
  for (const rel of flows) if (linesOf(join(lab, rel)) >= CAPS.flowLines) found.push(`${rel}: ${linesOf(join(lab, rel))} lines, cap ${CAPS.flowLines - 1}`);
  const config = files.filter((rel) => kindOf(rel) === "config");
  const total = config.reduce((n, rel) => n + linesOf(join(lab, rel)), 0);
  if (total > CAPS.configLines) found.push(`configuration ${total} lines, cap ${CAPS.configLines} (${config.map((rel) => `${rel} ${linesOf(join(lab, rel))}`).join(", ")})`);
  return found;
}

/**
 * L3: the UI files that reach the server themselves: a value imported from
 * the client (the entry may import `createClient`), a `.subscribe(` or a
 * `.flow(` call. `exempt` names files the rule skips.
 */
export function reachingTheServer(lab = LAB, exempt: readonly string[] = []): string[] {
  return filesUnder("src", lab).filter((rel) => isCode(rel) && !exempt.includes(rel)).flatMap((rel) => {
    const text = codeOf(join(lab, rel));
    const values = valueImports(text, "@flow-state-dev/client").filter((name) => !(rel === ENTRY && name === "createClient"));
    const subscribes = (text.match(/\.subscribe\(/g) ?? []).length;
    const flows = (text.match(/\.flow\(/g) ?? []).length;
    return [
      ...(values.length > 0 ? [`${rel}: imports ${values.join(", ")} from the client`] : []),
      ...(subscribes > 0 ? [`${rel}: ${subscribes} .subscribe( call(s)`] : []),
      ...(flows > 0 ? [`${rel}: ${flows} .flow( call(s)`] : []),
    ];
  });
}

/** L4: exported object types outside the components that aren't on {@link SCREEN_TYPES}. */
export function unlistedTypes(lab = LAB): string[] {
  const modules = filesUnder("src", lab).filter((rel) => /\.tsx?$/.test(rel) && !rel.startsWith("src/components/") && rel !== ENTRY && rel !== "src/App.tsx");
  return modules.flatMap((rel) =>
    [...readFileSync(join(lab, rel), "utf8").matchAll(/^export\s+(?:interface\s+(\w+)\b[^=]*|type\s+(\w+)(?:<[^>]*>)?\s*=\s*(.*))$/gm)]
      // A union of string literals names no row: only an object type can be one.
      .filter((m) => m[1] !== undefined || !/^("[^"]*"\s*\|?\s*)+;?$/.test(m[3]!.trim()))
      .map((m) => m[1] ?? m[2]!)
      .filter((name) => !(SCREEN_TYPES[rel] ?? []).includes(name))
      .map((name) => `${rel}: ${name}`),
  );
}

/**
 * H: the host wiring a kit replaces, in a host file: a `workerFlows: () =>`
 * callback, a call to workforce's retired installation or hire function, or
 * an `as never` cast.
 */
export function hostWiring(hostFile: string): string[] {
  return codeOf(hostFile)
    .split("\n")
    .flatMap((line, i) =>
      // The two retired names are split in the pattern: FIX-2627's callers census counts every mention of them.
      /workerFlows:\s*\(\)\s*=>|\b(createWorker(?:Installation)|hireWork(?:force))\(|\bas never\b/.test(line) ? [`${relative(join(dirname(hostFile), "../.."), hostFile)}:${i + 1}: ${line.trim()}`] : [],
    );
}
