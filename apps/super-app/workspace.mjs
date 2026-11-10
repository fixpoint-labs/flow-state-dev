/**
 * Keep the workspace's dependencies and package builds current for `pnpm dev`.
 *
 * Every hosted page imports the workspace packages through their built
 * `dist/`, so a page rebuilt against a stale `dist/` (or a missing
 * `node_modules`) shows yesterday's framework. Two steps fix that:
 *
 * - `install`: `pnpm install --frozen-lockfile`. Run once, before any app
 *   starts: replacing `node_modules` under a running server breaks it. Frozen,
 *   so a dev run never rewrites the lockfile; a mismatch is reported, not fixed.
 * - `packages`: `turbo run build` over `packages/*`. Run before each page
 *   build as well as at start. Turbo's cache makes it about a second when
 *   nothing changed, and a package whose source did change gets a new `dist/`,
 *   which the page build then picks up. Shift Manager is left out: its package
 *   build is a page build, which `rebuild.mjs` already runs for it.
 *
 * A failing step is reported and the run goes on: the pages still build
 * against the last good `dist/`, and a broken package shouldn't stop the
 * other apps from coming up.
 */

/** @typedef {{ cmd: string, args: string[], label: string }} WorkspaceStep */

/** @type {{ install: WorkspaceStep, packages: WorkspaceStep }} */
export const WORKSPACE_STEPS = {
  install: { cmd: "pnpm", args: ["install", "--frozen-lockfile", "--prefer-offline"], label: "[install]" },
  packages: { cmd: "pnpm", args: ["turbo", "run", "build", "--filter=./packages/*", "--filter=!@flow-state-dev/shift-manager"], label: "[packages]" },
};

/**
 * Build the refresh functions over a runner.
 *
 * `packages()` calls made while one is running share its result instead of
 * starting a second turbo run: three pages rebuilding together need one package
 * build, not three.
 *
 * @param {object} options
 * @param {(step: WorkspaceStep) => Promise<number>} options.run  Runs a step to its end; resolves with its exit code.
 * @param {(line: string) => void} [options.warn]  Where a failure is reported.
 * @returns {{ install(): Promise<boolean>, packages(): Promise<boolean> }}  Each resolves `true` when the step succeeded.
 */
export function createWorkspaceRefresh({ run, warn = () => {} }) {
  /** @type {Promise<boolean> | undefined} */
  let packagesRun;

  /** @param {WorkspaceStep} step @param {string} hint */
  const attempt = async (step, hint) => {
    const code = await run(step);
    if (code === 0) return true;
    warn(`${step.label} ${step.args.join(" ")} failed (exit ${code}). ${hint}`);
    return false;
  };

  return {
    install: () => attempt(WORKSPACE_STEPS.install, "Continuing with what is installed; run `pnpm install` by hand if the lockfile moved."),
    packages() {
      packagesRun ??= attempt(WORKSPACE_STEPS.packages, "Pages build against the last package build that worked.").finally(() => {
        packagesRun = undefined;
      });
      return packagesRun;
    },
  };
}
