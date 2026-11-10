/**
 * Build the goal page in a registry host, in its own process. Called by
 * `run.mts` with one JSON argument: `{ root, outDir, client }`.
 *
 * `root` is a fresh host the registry items were installed into
 * (`goals/lib/registry-host.mts`), which has no Vite config of its own: it
 * builds the way a Vite app on the registry does, with React, Tailwind and
 * the `@/` alias. `client` is `@flow-state-dev/client`'s source, which the
 * registry workspace does not list, aliased in for the page's sends.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { root, outDir, client } = JSON.parse(process.argv[2]!) as { root: string; outDir: string; client: string };

const load = async (name: string) => (await import(pathToFileURL(createRequire(join(root, "package.json")).resolve(name)).href)) as Record<string, any>;
const vite = (await load("vite")) as { build(config: Record<string, unknown>): Promise<unknown> };
await vite.build({
  root,
  configFile: false,
  logLevel: "error",
  resolve: {
    alias: [
      { find: /^@flow-state-dev\/client$/, replacement: client },
      { find: "@", replacement: root },
    ],
  },
  plugins: [(await load("@vitejs/plugin-react")).default(), (await load("@tailwindcss/vite")).default()],
  build: { outDir, emptyOutDir: true },
});
