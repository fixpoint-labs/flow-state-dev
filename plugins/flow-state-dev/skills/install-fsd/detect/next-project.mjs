/**
 * Resolutions 4, 4b, 5, 6 and 7 — the app root, the `next.config.*` Next itself loads, the route
 * extension, the mount URL, and route-slot occupancy.
 *
 * Every one of these is the output of somebody else's resolution algorithm, not a property you
 * can read off the directory: which config Next loads is a walk with an ordered candidate list,
 * which files occupy a route slot is a matcher's extension set, and what URL the mount answers on
 * is the router's `basePath` handling.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_PAGE_EXTENSIONS,
  EMITTABLE_ROUTE_EXTENSIONS,
  GENERATED_MARKER,
  MOUNT,
  NEXT_CONFIG_FILENAMES,
  NEXT_CONFIG_TS_ONLY_FILENAME,
  NEXT_MINIMUM_MAJOR,
} from "./constants.mjs";
import { ancestorsFrom, readIfPresent, readManifest } from "./fs-util.mjs";
import { plainString, plainStringArray, settingValue } from "./source-scan.mjs";

/**
 * Resolution 4 — the app root, resolved the way Next's `findDir` resolves it: `./app` is checked
 * **before** `./src/app` and the first that exists wins.
 *
 * This is why the app root is a reported field rather than the constant `app/`. Creating a root
 * `app/` in a project laid out under `src/app` does not extend their application — it changes
 * which directory Next treats as the app, and every route they had stops being served. Silent on
 * Next 15; on Next 16 a project with `src/pages` alongside gets a hard build failure instead.
 */
export function resolveAppRoot(writeRoot) {
  const app = ["app", join("src", "app")].find((rel) => existsSync(join(writeRoot, rel))) ?? null;
  const pages = ["pages", join("src", "pages")].find((rel) => existsSync(join(writeRoot, rel))) ?? null;
  return { appRoot: app, pagesDir: pages };
}

/**
 * Does the running Node load TypeScript directly?
 *
 * **`process.features.typescript` is a string, not a boolean.** Node reports `"strip"` or
 * `"transform"` when type stripping is on, and `false` when it is off — so `=== true` is never
 * satisfied on a Node that supports it, and this file would drop `next.config.mts` from the
 * candidate list on exactly the machines where Next itself accepts it. Measured on Node 22.22.2:
 * `typeof process.features.typescript === "string"`, value `"strip"`.
 *
 * Truthiness is the whole test, and it stays correct if Node adds a third mode.
 */
export function nodeStripsTypes() {
  return Boolean(process.features?.typescript);
}

/**
 * Resolution 4b — the `next.config.*` Next itself would load.
 *
 * `loadConfig` calls `findUp(CONFIG_FILES, { cwd })`, so it walks **upward** and takes the first
 * match; within a directory the order is `.js` → `.mjs` → `.ts` → `.mts`, and `.mts` is a
 * candidate only when the running Node strips types (see {@link nodeStripsTypes}). Two consequences:
 * a project with both `next.config.js` and `next.config.ts` is served by the `.js`, so parsing
 * the `.ts` reads settings that never apply; and an app with no config of its own inherits an
 * ancestor's, which is ordinary in a workspace.
 */
export function resolveNextConfig(writeRoot, { typescriptSupport = nodeStripsTypes() } = {}) {
  const names = typescriptSupport
    ? [...NEXT_CONFIG_FILENAMES, NEXT_CONFIG_TS_ONLY_FILENAME]
    : [...NEXT_CONFIG_FILENAMES];
  const candidates = [];
  for (const dir of ancestorsFrom(writeRoot)) {
    const present = names.map((name) => join(dir, name)).filter((path) => existsSync(path));
    candidates.push(...present);
    if (present.length > 0) {
      return { path: present[0], candidates, typescriptSupport, names };
    }
  }
  return { path: null, candidates, typescriptSupport, names };
}

/**
 * Resolutions 5 and 6 — the route extension and the mount URL, both read from resolution 4b's
 * file and from nothing else.
 *
 * Detection derives facts from the filesystem and from `git`; it never executes the project's
 * code, and `next.config.*` is a module that can export a function or compute its values. So the
 * common form — a plain array of literals, a plain string — is read statically, an absent setting
 * takes Next's documented default, and anything else is reported unreadable so the run can refuse
 * rather than write files that might be invisible or advertise a URL that 404s.
 */
export function resolveNextSettings(configPath) {
  const source = configPath === null ? null : readIfPresent(configPath);

  if (source === null) {
    return {
      pageExtensions: { enabled: DEFAULT_PAGE_EXTENSIONS, source: "Next's default", readable: true },
      basePath: { value: "", source: "unset", readable: true },
    };
  }

  const extensionsHit = settingValue(source, "pageExtensions");
  const basePathHit = settingValue(source, "basePath");

  const extensions = extensionsHit.unreadable
    ? null
    : extensionsHit.raw === null
      ? DEFAULT_PAGE_EXTENSIONS
      : plainStringArray(extensionsHit.raw);
  const basePath = basePathHit.unreadable
    ? null
    : basePathHit.raw === null
      ? ""
      : plainString(basePathHit.raw);

  return {
    pageExtensions: {
      enabled: extensions,
      source: extensionsHit.raw === null && !extensionsHit.unreadable ? "Next's default" : configPath,
      readable: extensions !== null,
      raw: extensionsHit.raw ?? null,
      why: extensionsHit.unreadable ?? null,
    },
    basePath: {
      value: basePath,
      source: basePathHit.raw === null && !basePathHit.unreadable ? "unset" : configPath,
      readable: basePath !== null,
      raw: basePathHit.raw ?? null,
      why: basePathHit.unreadable ?? null,
    },
  };
}

/**
 * Resolution 5's choice: prefer `ts`, fall back to `tsx`, and otherwise refuse — a route file we
 * could write would not be a route. `createValidFileMatcher` composes its pattern from
 * `pageExtensions`, so in a project configuring `['jsx','js']` a `route.ts` simply is not a route:
 * both mount files land, nothing errors, and the endpoint does not exist.
 */
export function chooseRouteExtension(enabled) {
  if (enabled === null) return null;
  return EMITTABLE_ROUTE_EXTENSIONS.find((ext) => enabled.includes(ext)) ?? null;
}

/**
 * Resolution 6's answer: `basePath` prefixes every route in the application, so the mount answers
 * at `<basePath>/api/flows`. Never advertise the bare path — Next's router tests the prefix and
 * returns before route matching, so a bare `/api/flows` is rejected upstream of the matcher.
 */
export function resolveMountPath(basePath) {
  if (basePath === null) return null;
  const trimmed = basePath === "/" ? "" : basePath.replace(/\/$/, "");
  return `${trimmed}${MOUNT.path}`;
}

/**
 * Resolution 7 — what occupies each route slot the run would write.
 *
 * The unit is the **slot** (a directory plus the leaf name `route`), not the filename we selected,
 * because Next treats any enabled extension there as that route. And the scan set is every
 * currently enabled extension **union** every extension this skill can emit: the enabled half
 * finds files that are live routes today, ours or theirs; the emitted half finds files *we* left
 * behind that are dormant today and become live if `pageExtensions` widens again. Scanning only
 * the enabled set reports an occupied slot empty, writes a second handler beside the stale one,
 * and makes the refusal that exists for that state unreachable.
 */
export function scanRouteSlots(appRootAbs, enabledExtensions) {
  const scanSet = [...new Set([...(enabledExtensions ?? []), ...EMITTABLE_ROUTE_EXTENSIONS])];
  return MOUNT.slots.map((slot) => {
    const dir = join(appRootAbs, slot);
    const occupants = [];
    for (const ext of scanSet) {
      const path = join(dir, `${MOUNT.leaf}.${ext}`);
      if (!existsSync(path)) continue;
      const content = readIfPresent(path) ?? "";
      occupants.push({
        path,
        extension: ext,
        ours: content.includes(GENERATED_MARKER),
        enabled: (enabledExtensions ?? []).includes(ext),
      });
    }
    return { slot: join(appRootAbs, slot), leaf: MOUNT.leaf, scanSet, occupants };
  });
}

/**
 * Classify a scanned slot into what the run may do with it. Occupancy finds the files; the
 * **marker** classifies each one. A rule that refused on occupancy alone would refuse every rerun
 * of a project this skill wired up itself, which is the common path.
 */
export function classifySlot(slot, selectedExtension) {
  if (slot.occupants.length === 0) return { verdict: "write", occupants: [] };
  const foreign = slot.occupants.filter((o) => !o.ours);
  if (foreign.length > 0) return { verdict: "refuse-foreign", occupants: foreign };
  const stale = slot.occupants.filter((o) => o.extension !== selectedExtension);
  if (stale.length > 0) return { verdict: "refuse-stale", occupants: stale };
  return { verdict: "ours", occupants: slot.occupants };
}

/** The major version a `next` dependency range asks for, or `null` when it is not a readable range. */
export function nextMajorFrom(range) {
  if (typeof range !== "string") return null;
  const match = /(\d+)\s*\./.exec(range.replace(/^[\^~>=<\s]*/, ""));
  return match === null ? null : Number(match[1]);
}

/**
 * The host, read from the write root's manifest and directory conventions.
 *
 * `next` **only** when the App Router convention is present **and** the declared `next` satisfies
 * `>=15`. Any other Next shape — Pages Router, or Next below 15 — is `next-unsupported`, which
 * refuses. It must never fall back to `node`: that would write a second-process setup into a Next
 * app, and a report of plain `next` for either shape would hand the skill a green light for a host
 * it has no design for, so the four files land and then the install fails or the route never
 * answers.
 */
export function classifyHost(writeRoot) {
  const manifest = readManifest(writeRoot);
  const deps = { ...(manifest?.dependencies ?? {}), ...(manifest?.devDependencies ?? {}) };
  const nextRange = deps.next;
  const { appRoot, pagesDir } = resolveAppRoot(writeRoot);

  if (nextRange === undefined) {
    return { value: "node", nextRange: null, nextMajor: null, router: null, appRoot, pagesDir, failed: [] };
  }

  const major = nextMajorFrom(nextRange);
  const failed = [];
  if (appRoot === null) failed.push("app-router");
  if (major !== null && major < NEXT_MINIMUM_MAJOR) failed.push("next-version");
  if (major === null) failed.push("next-version-unreadable");

  const router = appRoot !== null ? "app" : pagesDir !== null ? "pages" : null;
  if (failed.length > 0) {
    return { value: "next-unsupported", nextRange, nextMajor: major, router, appRoot, pagesDir, failed };
  }
  return { value: "next", nextRange, nextMajor: major, router: "app", appRoot, pagesDir, failed: [] };
}

/**
 * Does this script name need the end-of-options separator to reach the package manager as a
 * script rather than as one of its own options?
 *
 * A leading dash is the whole rule. `npm run --help` prints npm's help and never runs the script;
 * `npm run -- --help` runs it. Measured on npm, pnpm and Yarn.
 *
 * **This is the shared half of a pair.** `runSeparatorFor` in `@flow-state-dev/fsdev` emits the
 * separator for exactly these names, and `test/host-and-next.test.mjs` runs both over one table
 * and fails if their verdicts diverge. Not a refusal: the printed command works, so a project
 * whose dev script is called `--help` is a coherent host and detection only has to report it.
 */
export function needsRunSeparator(name) {
  return name.startsWith("-");
}

/**
 * The script that starts the host app and the port it lands on, read from `scripts`.
 *
 * Chosen by name where a `dev` script exists, otherwise by finding the single script that starts
 * the host. A port stated in that script's own flags is used; with no port stated the framework's
 * default is named as a default rather than asserted as fact.
 */
export function resolveDevCommand(writeRoot, host) {
  const scripts = readManifest(writeRoot)?.scripts ?? {};
  const entries = Object.entries(scripts);
  if (entries.length === 0) return { script: null, command: null, port: null, url: null, needsSeparator: false };

  const starters = entries.filter(([, command]) => /(^|\s|&&\s*)(next\s+dev|node\s|nodemon|tsx\s|ts-node)/.test(command));
  // A `dev` script by name, else the single script that starts the host. More than one starter
  // and nothing says which is the host's, so there is no identifiable dev script.
  const chosen =
    entries.find(([name]) => name === "dev") ?? (starters.length === 1 ? starters[0] : null);
  if (chosen === null) return { script: null, command: null, port: null, url: null, needsSeparator: false };

  const [script, command] = chosen;
  const portMatch = /(?:-p|--port)[= ](\d+)/.exec(command);
  const port = portMatch === null ? null : Number(portMatch[1]);
  const defaultPort = host === "next" ? 3000 : null;
  const effective = port ?? defaultPort;
  return {
    script,
    command,
    port,
    defaultPort,
    url: effective === null ? null : `http://localhost:${effective}`,
    // Reported, not refused: the renderer separates these and the printed command runs.
    needsSeparator: needsRunSeparator(script),
  };
}

/** The absolute app root, for a host that has one. */
export function appRootAbsolute(writeRoot, appRoot) {
  return appRoot === null ? null : join(writeRoot, appRoot);
}

/** Every dependency of ours the write root already declares, at the version it declares. */
export function declaredFsdDependencies(writeRoot) {
  const manifest = readManifest(writeRoot);
  const all = { ...(manifest?.dependencies ?? {}), ...(manifest?.devDependencies ?? {}) };
  const found = {};
  for (const [name, range] of Object.entries(all)) {
    if (name.startsWith("@flow-state-dev/")) found[name] = range;
  }
  return found;
}

/** The module system the nearest manifest declares — `module`, `commonjs`, or absent. */
export function moduleSystemOf(writeRoot) {
  const type = readManifest(writeRoot)?.type;
  return type === "module" || type === "commonjs" ? type : "absent";
}

