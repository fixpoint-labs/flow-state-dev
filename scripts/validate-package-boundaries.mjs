import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const packages = ["contracts", "core", "engine", "client", "react", "testing", "cli", "store-sqlite", "orchestration", "patterns", "workforce"];

const packageRules = {
  // The zero-dependency shared layer: imports no workspace package. Its
  // dependency-freeness is additionally guarded by contracts-zero-dep.spec.ts.
  contracts: {
    allow: new Set([]),
    typeOnly: new Set([]),
    deny: new Set(["core", "engine", "client", "react", "testing", "cli", "store-sqlite"])
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
  cli: {
    allow: new Set(["contracts", "core", "engine", "testing", "store-sqlite"]),
    typeOnly: new Set([])
  },
  "store-sqlite": {
    allow: new Set(["contracts", "core", "engine"]),
    typeOnly: new Set(["engine"]),
    deny: new Set(["client", "react"])
  },
  // Core-layer orchestration substrate: depends only on core. Must never
  // import patterns or workforce — that would create a cycle with the two
  // layers built on top of it.
  orchestration: {
    allow: new Set(["contracts", "core"]),
    typeOnly: new Set([]),
    deny: new Set(["engine", "client", "react", "patterns", "workforce"])
  },
  // Compositions built on the task board — may import orchestration, never
  // workforce (a sibling layer, not a dependency).
  patterns: {
    allow: new Set(["contracts", "core", "orchestration"]),
    typeOnly: new Set([]),
    deny: new Set(["engine", "client", "react", "workforce"])
  },
  // Layer 2 on orchestration — may import orchestration, never patterns.
  workforce: {
    allow: new Set(["contracts", "core", "orchestration"]),
    typeOnly: new Set([]),
    deny: new Set(["engine", "client", "react", "patterns"])
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

/**
 * Packages whose published name is not `@flow-state-dev/<directory>`, mapped to
 * the internal key `packageRules` uses — which is the DIRECTORY name.
 *
 * Matched on the exact full package name, never by scope prefix. That is the
 * whole point, and it survived the CLI's name changing twice (FIX-1191):
 *
 *   - As unscoped `fsdev`, a scope-prefix rule skipped the package outright.
 *   - As `@flow-state-dev/fsdev` it matches the scope again, which looks like
 *     the prefix rule would now work. It does not: the rule takes the segment
 *     after the scope (`fsdev`) and looks it up in `packages`, which holds
 *     `cli`. It resolves to nothing and every import is skipped, exactly as
 *     before.
 *
 * Both times the failure is silent, because a guard that recognises nothing
 * reports success: restricted packages could import the CLI with no allow/deny
 * check and no cycle detection while typecheck and the full suite stayed green.
 * Do not "simplify" this back to a prefix test.
 */
const PACKAGE_NAME_TO_KEY = new Map([["@flow-state-dev/fsdev", "cli"]]);

function resolveWorkspacePackage(specifier) {
  const [scope, name] = specifier.split("/");
  const packageName = scope.startsWith("@") ? `${scope}/${name ?? ""}` : scope;

  const mapped = PACKAGE_NAME_TO_KEY.get(packageName);
  if (mapped !== undefined) {
    return packages.includes(mapped) ? mapped : undefined;
  }

  if (scope !== "@flow-state-dev") {
    return undefined;
  }

  return packages.includes(name) ? name : undefined;
}

/** How a package is spelled in an import, for error messages. */
function specifierFor(pkg) {
  for (const [name, key] of PACKAGE_NAME_TO_KEY) {
    if (key === pkg) return name;
  }
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

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log("package boundary validation passed");
