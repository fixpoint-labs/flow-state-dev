/**
 * Every constant the detection scripts key on, in one place.
 *
 * These scripts run from an installed plugin on a stranger's machine, so this whole directory
 * is dependency-free ESM that imports nothing from this monorepo at run time. A value that also
 * exists in `@flow-state-dev/fsdev` is duplicated here on purpose and named as a twin, because
 * an import edge would make the scripts unusable exactly where they are meant to run. Where a
 * twin exists, the test suite asserts the two agree rather than trusting the comment.
 */

/** The `fsdev.config.*` filenames the CLI probes, in its own precedence order. Twin of `CONFIG_FILENAMES`. */
export const FSDEV_CONFIG_FILENAMES = [
  "fsdev.config.ts",
  "fsdev.config.mts",
  "fsdev.config.js",
  "fsdev.config.mjs",
];

/**
 * Next's own config candidates, in the order `findUp(CONFIG_FILES, { cwd })` tries them within a
 * directory. `next.config.mts` is a candidate only when the running Node reports TypeScript
 * support, which is a property of the machine rather than of the project.
 */
export const NEXT_CONFIG_FILENAMES = ["next.config.js", "next.config.mjs", "next.config.ts"];
export const NEXT_CONFIG_TS_ONLY_FILENAME = "next.config.mts";

/** Next's default `pageExtensions`, from `dist/server/config-shared.js`. */
export const DEFAULT_PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];

/** The only extensions this skill can emit for a route file. Widens the slot scan beyond what is enabled. */
export const EMITTABLE_ROUTE_EXTENSIONS = ["ts", "tsx"];

/** Package managers the skill has command forms for. Anything else refuses. */
export const SUPPORTED_PACKAGE_MANAGERS = ["npm", "pnpm", "yarn"];

/** Lockfile name → the manager it evidences. A lockfile is evidence, never a workspace boundary. */
export const LOCKFILES = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
};

/**
 * The Node floor for a wired-up project — not the `>=22` our packages declare.
 *
 * 22.0–22.17 passes `>=22` and then fails every printed command at config load, because the CLI
 * imports the emitted TypeScript config natively and that needs type stripping.
 */
export const NODE_FLOOR = "22.18.0";

/** The provider keys detection resolves. Closed at three, and all three are resolved before the developer picks one. */
export const PROVIDER_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"];

/** The credential this run generates for the demo flow. Fixed name, so its resolution needs no answer first. */
export const DEMO_TOKEN_KEY = "FSD_DEMO_TOKEN";

/** Every secret variable the run touches. The report carries a status and a path for each, never a value. */
export const SECRET_KEYS = [...PROVIDER_KEYS, DEMO_TOKEN_KEY];

/** The env files `next dev` reads, in its own order, from ONE directory — there is no walk. */
export const NEXT_DEV_ENV_FILES = [".env.development.local", ".env.local", ".env.development", ".env"];

/** The single env file our CLI walks for, from the write root upward. */
export const CLI_ENV_FILE = ".env.local";

/** The marker a file this skill authored whole carries, so a rerun can tell its own work from theirs. */
export const GENERATED_MARKER = "fsd:generated";

/** The delimiters bounding a section this skill appends to a file the developer owns. */
export const SECTION_DELIMITERS = {
  markdown: { start: "<!-- flow-state-dev:start -->", end: "<!-- flow-state-dev:end -->" },
  hash: { start: "# flow-state-dev:start", end: "# flow-state-dev:end" },
};

/** The demo flow this run registers, and the module path it is registered from. */
export const DEMO_FLOW = { kind: "hello", modulePath: "./flows/hello/flow.mts" };

/** Where a Next mount lands, relative to the app root, and where it answers before any `basePath`. */
export const MOUNT = {
  slots: ["api/flows", "api/flows/[...path]"],
  leaf: "route",
  path: "/api/flows",
};

/** The minimum `next` major the adapters accept, from their declared `next: ">=15.0.0"` peer range. */
export const NEXT_MINIMUM_MAJOR = 15;
