import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const packages = ["core", "server", "client", "react", "testing", "cli", "store-sqlite"];

const packageRules = {
  core: {
    allow: new Set([]),
    typeOnly: new Set([])
  },
  server: {
    allow: new Set(["core"]),
    typeOnly: new Set([]),
    deny: new Set(["client", "react"])
  },
  client: {
    allow: new Set(["core"]),
    typeOnly: new Set(["core"]),
    deny: new Set(["server", "react"])
  },
  react: {
    allow: new Set(["core", "client"]),
    typeOnly: new Set(["core"]),
    deny: new Set(["server"])
  },
  testing: {
    allow: new Set(["core", "server"]),
    typeOnly: new Set([]),
    deny: new Set(["client", "react"])
  },
  cli: {
    allow: new Set(["core", "server", "testing"]),
    typeOnly: new Set([])
  },
  "store-sqlite": {
    allow: new Set(["core", "server"]),
    typeOnly: new Set(["server"]),
    deny: new Set(["client", "react"])
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
  if (!specifier.startsWith("@flow-state-dev/")) {
    return undefined;
  }

  const packageName = specifier.split("/")[1];
  return packages.includes(packageName) ? packageName : undefined;
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
        errors.push(`${filePath}: forbidden import from @flow-state-dev/${targetPkg}`);
      }

      if (!rules.allow.has(targetPkg)) {
        errors.push(`${filePath}: package ${pkg} is not allowed to import @flow-state-dev/${targetPkg}`);
      }

      if (rules.typeOnly.has(targetPkg) && !isTypeOnly) {
        errors.push(`${filePath}: import from @flow-state-dev/${targetPkg} must be type-only`);
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
