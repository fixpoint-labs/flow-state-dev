/**
 * Copies the panel's Tailwind v4 source CSS from src/react/styles.css into
 * dist/react/styles.css so consumers can import it via the
 * `@flow-state-dev/devtool/react/styles.css` subpath export.
 *
 * TSC alone doesn't emit non-TS files, so this runs as a postbuild step.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const source = resolve(packageRoot, "src/react/styles.css");
const targetDir = resolve(packageRoot, "dist/react");
const target = resolve(targetDir, "styles.css");

if (!existsSync(source)) {
  console.error("copy-styles: source not found at", source);
  process.exit(1);
}

if (!existsSync(targetDir)) {
  mkdirSync(targetDir, { recursive: true });
}

copyFileSync(source, target);
console.log("copy-styles: copied", source, "->", target);
