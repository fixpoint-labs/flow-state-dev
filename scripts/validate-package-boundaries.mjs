import fs from "node:fs";
import path from "node:path";
import { compilerDeclarationErrors } from "./compiler-declarations.mjs";
import { workspaceManifests } from "./workspace-members.mjs";

const rootDir = process.cwd();
const packages = ["contracts", "core", "engine", "client", "react", "testing", "fsdev", "store-sqlite", "store-postgres", "orchestration", "patterns", "workforce"];

const packageRules = {
  // The zero-dependency shared layer: imports no workspace package. Its
  // dependency-freeness is additionally guarded by contracts-zero-dep.spec.ts.
  contracts: {
    allow: new Set([]),
    typeOnly: new Set([]),
    deny: new Set(["core", "engine", "client", "react", "testing", "fsdev", "store-sqlite", "store-postgres"])
  },
  core: {
    allow: new Set(["contracts"]),
    typeOnly: new Set([])
  },
  engine: {
    allow: new Set(["contracts", "core"]),
    typeOnly: new Set([]),
    deny: new Set(["client", "react"])
  },
  client: {
    // `contracts` is value-importable; `core` stays type-only for browser code.
    allow: new Set(["contracts", "core"]),
    typeOnly: new Set(["core"]),
    deny: new Set(["engine", "react"])
  },
  react: {
    // `contracts` is value-importable; `core` stays type-only for browser code.
    allow: new Set(["contracts", "core", "client"]),
    typeOnly: new Set(["core"]),
    deny: new Set(["engine"])
  },
  testing: {
    allow: new Set(["contracts", "core", "engine"]),
    typeOnly: new Set([]),
    deny: new Set(["client", "react"])
  },
  // A leaf consumer of published surfaces: the terminal interface reaches for
  // whatever a command needs to drive. Nothing imports `fsdev`, so this list has
  // no cycle to create and no layer to invert — it is an enumeration of what
  // the CLI ships, and it grows as commands do. Contrast the entries above and
  // below, whose `deny` sets encode a refusal; this one encodes none.
  fsdev: {
    allow: new Set(["contracts", "core", "engine", "testing", "store-sqlite", "workforce"]),
    typeOnly: new Set([])
  },
  "store-sqlite": {
    allow: new Set(["contracts", "core", "engine"]),
    typeOnly: new Set(["engine"]),
    deny: new Set(["client", "react"])
  },
  // Same layer as store-sqlite, minus one constraint: store-postgres value-imports
  // engine runtime (its in-memory trace store and the live-tail helpers, including
  // the StoreSubscriptionError it throws to callers), where store-sqlite keeps local
  // copies. Making it type-only would mean copying that code and changing the error
  // callers catch. `scheduled` imports are unchecked for both adapters, since
  // `scheduled` is not in `packages`.
  "store-postgres": {
    allow: new Set(["contracts", "core", "engine"]),
    typeOnly: new Set([]),
    deny: new Set(["client", "react"])
  },
  // Core-layer orchestration substrate: depends on core. Must never
  // import patterns or workforce — that would create a cycle with the two
  // layers built on top of it. `client` is allowed for the Inbox's browser
  // client (`@flow-state-dev/orchestration/inbox`, FIX-2133), which answers a
  // hold over the isomorphic client, as workforce's `createWorkforceClient`
  // does; the client imports only core and contracts, so this adds no cycle.
  orchestration: {
    allow: new Set(["contracts", "core", "client"]),
    typeOnly: new Set([]),
    deny: new Set(["engine", "react", "patterns", "workforce"])
  },
  // Compositions built on the task board — may import orchestration, never
  // workforce (a sibling layer, not a dependency). `testing` is type-only: the
  // benchmark adapters on `patterns/benchmark` type against the contract on
  // `testing/benchmark` (an optional peer), and a type import erases at
  // runtime, so patterns never loads testing.
  patterns: {
    allow: new Set(["contracts", "core", "orchestration", "testing"]),
    typeOnly: new Set(["testing"]),
    deny: new Set(["engine", "client", "react", "workforce"])
  },
  // Layer 2 on orchestration — may import orchestration, never patterns.
  // `client` is allowed for `createWorkforceClient`, which finds and starts a
  // worker's sessions over the session client (FIX-1788). The client is
  // isomorphic and imports only core and contracts, so this adds no cycle.
  workforce: {
    allow: new Set(["contracts", "core", "orchestration", "client"]),
    typeOnly: new Set([]),
    deny: new Set(["engine", "react", "patterns"])
  }
};

const importPattern = /(import|export)\s+(type\s+)?(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g;

function walkTsFiles(dirPath, files = []) {
  if (!fs.existsSync(dirPath)) {
    return files;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(fullPath, files);
      continue;
    }

    if (entry.isFile() && (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx"))) {
      files.push(fullPath);
    }
  }

  return files;
}

function resolveWorkspacePackage(specifier) {
  const [scope, name] = specifier.split("/");
  if (scope !== "@flow-state-dev") {
    return undefined;
  }

  return packages.includes(name) ? name : undefined;
}

/** How a package is spelled in an import, for error messages. */
function specifierFor(pkg) {
  return `@flow-state-dev/${pkg}`;
}

function detectCycles(graph) {
  const visited = new Set();
  const stack = new Set();
  const cycles = [];

  function dfs(node, pathStack) {
    visited.add(node);
    stack.add(node);
    pathStack.push(node);

    for (const next of graph.get(node) ?? []) {
      if (!visited.has(next)) {
        dfs(next, pathStack);
        continue;
      }

      if (stack.has(next)) {
        const cycleStart = pathStack.indexOf(next);
        cycles.push([...pathStack.slice(cycleStart), next]);
      }
    }

    stack.delete(node);
    pathStack.pop();
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return cycles;
}

const errors = [];
const graph = new Map();

for (const pkg of packages) {
  graph.set(pkg, new Set());

  // Each key is both a directory under packages/ and the name after the scope.
  // If the two drift apart, imports of the package resolve to nothing and the
  // checks below pass without checking it, so the drift itself is the error.
  const manifestPath = path.join(rootDir, "packages", pkg, "package.json");
  const name = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")).name : undefined;
  if (name !== specifierFor(pkg)) {
    errors.push(`packages/${pkg}: expected package name ${specifierFor(pkg)}, found ${name ?? "no package.json"}`);
  }

  const srcDir = path.join(rootDir, "packages", pkg, "src");
  const files = walkTsFiles(srcDir);
  const rules = packageRules[pkg];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");

    for (const match of content.matchAll(importPattern)) {
      const isTypeOnly = match[2] !== undefined;
      const specifier = match[3];
      const targetPkg = resolveWorkspacePackage(specifier);

      if (targetPkg === undefined || targetPkg === pkg) {
        continue;
      }

      graph.get(pkg).add(targetPkg);

      if (rules.deny?.has(targetPkg)) {
        errors.push(`${filePath}: forbidden import from ${specifierFor(targetPkg)}`);
      }

      if (!rules.allow.has(targetPkg)) {
        errors.push(`${filePath}: package ${pkg} is not allowed to import ${specifierFor(targetPkg)}`);
      }

      if (rules.typeOnly.has(targetPkg) && !isTypeOnly) {
        errors.push(`${filePath}: import from ${specifierFor(targetPkg)} must be type-only`);
      }
    }
  }
}

const cycles = detectCycles(graph);
for (const cycle of cycles) {
  errors.push(`circular dependency detected: ${cycle.join(" -> ")}`);
}

// One compiler (scripts/compiler-declarations.mjs has the rule and its exceptions).
const rootTypescript = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).devDependencies?.typescript;
for (const manifestPath of workspaceManifests(rootDir)) {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, manifestPath), "utf8"));
  errors.push(...compilerDeclarationErrors(manifestPath, manifest, rootTypescript));
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log("package boundary validation passed");
