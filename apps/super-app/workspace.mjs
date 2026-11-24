/**
 * Install the workspace's dependencies before `pnpm dev` starts any app.
 *
 * `pnpm install --frozen-lockfile`: what a pull added to the lockfile gets
 * installed, and a dev run never rewrites the lockfile. A mismatch is reported,
 * not fixed. It is about a second when nothing changed.
 *
 * Only ever at start. Replacing `node_modules` under a running server breaks it.
 *
 * No package build belongs here. Every workspace package's runtime entry is its
 * `src/` (`"default": "./src/index.ts"`; `dist/` is types and publish output),
 * so the pages bundle package source, `tsx` runs it, and Next transpiles it. A
 * package edit already reaches a page through the page watcher (`rebuild.mjs`),
 * which records package source files among its inputs.
 */

/** @typedef {{ cmd: string, args: string[], label: string }} WorkspaceStep */

/** @type {WorkspaceStep} */
const INSTALL = { cmd: "pnpm", args: ["install", "--frozen-lockfile", "--prefer-offline"], label: "[install]" };

/**
 * Run the install. A failure is reported and the run goes on with what is
 * installed: the apps come up, and a lockfile that moved is the developer's to
 * install by hand.
 *
 * @param {object} options
 * @param {(step: WorkspaceStep) => Promise<number>} options.run  Runs a step to its end; resolves with its exit code.
 * @param {(line: string) => void} [options.warn]  Where a failure is reported.
 * @returns {Promise<void>}
 */
export async function installWorkspace({ run, warn = () => {} }) {
  const code = await run(INSTALL);
  if (code !== 0) {
    warn(`${INSTALL.label} ${INSTALL.args.join(" ")} failed (exit ${code}). Continuing with what is installed; run \`pnpm install\` by hand if the lockfile moved.`);
  }
}
