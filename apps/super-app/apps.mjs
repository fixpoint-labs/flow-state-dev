/**
 * The apps the super app hosts: where each is reached on the proxy, the
 * loopback port it listens on behind it, and how it starts.
 *
 * Two kinds, by how each takes its sub-route:
 *
 * - `next`: Kitchen Sink, built with Next's `basePath` set to the route
 *   (`KITCHEN_SINK_BASE_PATH`), so it serves under the prefix itself. The proxy
 *   passes the path through unchanged. Its sub-route build lives in its own
 *   `distDir`, apart from the root-served `.next`.
 * - `spa`: the `fsdev dev --app` labs. Each serves at the root of its port, so
 *   the proxy strips the prefix on the way in, and rewrites the page's
 *   `<base href="/">` to the prefix on the way out: the pages build with
 *   relative asset URLs and read their API's base from that `<base>`
 *   (`readBasePath()` in `@flow-state-dev/devtool/react`).
 *
 * Every app listens on 127.0.0.1 only; the proxy is the one network listener.
 */
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const REPO = fileURLToPath(new URL("../..", import.meta.url));

const TSX = join(REPO, "node_modules/.bin/tsx");
const FSDEV = join(REPO, "packages/cli/bin/fsdev.ts");
const bin = (dir, name) => join(REPO, dir, "node_modules/.bin", name);

/** Kitchen Sink's env for its sub-route build and server: `next.config.mjs` reads both. */
export const KITCHEN_SINK_ENV = {
  KITCHEN_SINK_BASE_PATH: "/kitchen-sink",
  KITCHEN_SINK_DIST_DIR: ".next-super-app",
};

/**
 * @typedef {object} Step  One process: a command, its folder, and env added to the parent's.
 * @property {string} cmd
 * @property {string[]} args
 * @property {string} cwd
 * @property {Record<string,string>} [env]
 * @property {boolean} [background]  Runs beside the steps after it instead of before them (a watcher). `run.mjs` doesn't wait for it, and its exit doesn't stop the app.
 * @property {string} [rebuildOnChange]  A background build's output folder: `run.mjs` runs the step again whenever a file that folder's last build recorded changes (`rebuild.mjs`), rather than once.
 *
 * @typedef {object} HostedApp
 * @property {string} id         Log prefix and route name.
 * @property {string} title      Shown on the landing page.
 * @property {string} blurb      One line under the title.
 * @property {string} prefix     The proxy's sub-route, no trailing slash.
 * @property {number} port       The loopback port it listens on.
 * @property {"next"|"spa"} kind
 * @property {string} [devtoolUserId]  The one user the app runs as, for the DevTool to open it as. An `spa` app declares its own in the pages it serves, which the DevTool reads; a Next app's pages carry none.
 * @property {{ dev: Step[], serve: Step[] }} run  Steps in order; the last one is the long-lived server.
 */

/** @type {HostedApp[]} */
export const APPS = [
  {
    id: "kitchen-sink",
    title: "Kitchen Sink",
    blurb: "The reference app: Flow State mode and the coding harness modes.",
    prefix: "/kitchen-sink",
    port: 3110,
    kind: "next",
    // `KITCHEN_SINK_USER_ID` in `apps/kitchen-sink/lib/kitchen-sink-principal.ts`: every caller of the app resolves to it.
    devtoolUserId: "devuser",
    run: {
      dev: [
        {
          cmd: bin("apps/kitchen-sink", "next"),
          args: ["dev", "-p", "3110", "-H", "127.0.0.1"],
          cwd: join(REPO, "apps/kitchen-sink"),
          env: { ...KITCHEN_SINK_ENV, WATCHPACK_POLLING: "true" },
        },
      ],
      serve: [
        {
          cmd: bin("apps/kitchen-sink", "next"),
          args: ["start", "-p", "3110", "-H", "127.0.0.1"],
          cwd: join(REPO, "apps/kitchen-sink"),
          env: KITCHEN_SINK_ENV,
        },
      ],
    },
  },
  {
    id: "shift-manager",
    title: "Shift Manager",
    blurb: "Work a Workforce Lab: the inbox, the task board, the roster.",
    prefix: "/shift-manager",
    port: 3120,
    kind: "spa",
    // The checkout's `start` script: rebuilds the pages first when they are older than their source.
    run: (() => {
      const cwd = join(REPO, "packages/shift-manager");
      const step = { cmd: TSX, args: ["scripts/checkout.mts", "--port", "3120", "--no-open"], cwd };
      // The checkout builds the pages once, when they're stale; this rebuilds them as their source changes.
      const pages = { cmd: bin("packages/shift-manager", "vite"), args: ["build"], cwd, background: true, rebuildOnChange: join(cwd, "dist-client") };
      return { dev: [pages, step], serve: [step] };
    })(),
  },
  {
    id: "teammates",
    title: "Teammates",
    blurb: "Teammates to talk to, and coding workers that take on their tasks.",
    prefix: "/teammates",
    port: 3130,
    kind: "spa",
    run: (() => {
      const cwd = join(REPO, "labs/teammates");
      const server = { cmd: TSX, args: [FSDEV, "dev", "--app", "@flow-state-dev/teammates", "--port", "3130", "--no-open"], cwd };
      const vite = bin("labs/teammates", "vite");
      return {
        dev: [{ cmd: vite, args: ["build"], cwd }, { cmd: vite, args: ["build"], cwd, background: true, rebuildOnChange: join(cwd, "dist-client") }, server],
        serve: [server],
      };
    })(),
  },
  {
    id: "claude-code-style",
    title: "Claude Code Style",
    blurb: "A Claude Code style desk: threads, projects and coding runs.",
    prefix: "/claude-code-style",
    port: 3140,
    kind: "spa",
    // Runs from the repository root, as its own `dev` script does: its data folder and default repository are read from there.
    run: (() => {
      const server = {
        cmd: TSX,
        args: [FSDEV, "dev", "--config", "labs/claude-code-style/fsdev.config.mts", "--app", "@flow-state-dev/claude-code-style", "--port", "3140", "--no-open"],
        cwd: REPO,
      };
      const lab = join(REPO, "labs/claude-code-style");
      const vite = bin("labs/claude-code-style", "vite");
      const pages = { cmd: vite, args: ["build"], cwd: lab };
      const watch = { cmd: vite, args: ["build"], cwd: lab, background: true, rebuildOnChange: join(lab, "dist-client") };
      return { dev: [pages, watch, server], serve: [server] };
    })(),
  },
];
