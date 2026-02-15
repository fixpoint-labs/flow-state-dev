import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const packageDir = process.cwd();
const tsconfigPath = path.join(packageDir, "tsconfig.json");
const srcDir = path.join(packageDir, "src");
const tscPath = path.join(rootDir, "node_modules", ".bin", "tsc");

if (!fs.existsSync(tsconfigPath)) {
  console.error(`typecheck failed: missing tsconfig at ${tsconfigPath}`);
  process.exit(1);
}

if (!fs.existsSync(srcDir)) {
  console.error(`typecheck failed: missing src directory at ${srcDir}`);
  process.exit(1);
}

if (fs.existsSync(tscPath)) {
  const tscRun = spawnSync(tscPath, ["-p", "tsconfig.json", "--noEmit"], {
    cwd: packageDir,
    stdio: "inherit"
  });

  process.exit(tscRun.status ?? 1);
}

const files = [];
const importErrors = [];

function walk(dirPath) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
}

function resolveRelativeImport(fromFilePath, specifier) {
  const basePath = path.resolve(path.dirname(fromFilePath), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mts`,
    `${basePath}.cts`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx")
  ];

  return candidates.some((candidate) => fs.existsSync(candidate));
}

walk(srcDir);

const importPattern = /(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g;

for (const filePath of files) {
  const content = fs.readFileSync(filePath, "utf8");

  for (const match of content.matchAll(importPattern)) {
    const specifier = match[1];

    if (specifier.startsWith("/")) {
      importErrors.push(`${filePath}: absolute import is not allowed (${specifier})`);
      continue;
    }

    if (specifier.startsWith(".")) {
      if (!resolveRelativeImport(filePath, specifier)) {
        importErrors.push(`${filePath}: unresolved relative import (${specifier})`);
      }
      continue;
    }

    if (specifier.startsWith("@flow-state-dev/")) {
      continue;
    }
  }
}

if (importErrors.length > 0) {
  for (const error of importErrors) {
    console.error(error);
  }
  process.exit(1);
}

console.log(`static typecheck passed (${path.relative(rootDir, packageDir)}): ${files.length} source file(s) validated`);
