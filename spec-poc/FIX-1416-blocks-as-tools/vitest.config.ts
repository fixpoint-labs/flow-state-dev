/**
 * Throwaway config so this POC can run outside any workspace package.
 *
 * `spec-poc/` is deliberately not a pnpm package (see `spec-poc/README.md`), so
 * it has no `node_modules` of its own. Only the specifiers the POC's own test
 * file imports need aliasing — everything the package sources import resolves
 * normally through their own `node_modules` symlinks.
 */
import path from "node:path";
import { defineConfig } from "vitest/config";

const repo = path.resolve(import.meta.dirname, "../..");
const pkg = (p: string) => path.join(repo, "packages", p);

export default defineConfig({
  resolve: {
    alias: [
      { find: /^zod$/, replacement: path.join(pkg("core"), "node_modules/zod") },
      { find: /^@flow-state-dev\/core$/, replacement: path.join(pkg("core"), "src/index.ts") },
      {
        find: /^@flow-state-dev\/core\/types$/,
        replacement: path.join(pkg("core"), "src/types/index.ts"),
      },
      { find: /^@flow-state-dev\/testing$/, replacement: path.join(pkg("testing"), "src/index.ts") },
      { find: /^@flow-state-dev\/engine$/, replacement: path.join(pkg("engine"), "src/index.ts") },
    ],
  },
});
