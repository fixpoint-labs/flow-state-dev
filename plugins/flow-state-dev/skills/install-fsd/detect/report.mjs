/**
 * Assemble the detection report and decide every refusal.
 *
 * > **Every refusal is decided from state the run has not modified.**
 * > Nothing is written until every refusal condition has been evaluated and none fired.
 *
 * The conditions are enumerated here, in one list, and the whole module writes nothing — so there
 * is no state for a refusal to depend on having changed.
 *
 * Every field cites a numbered resolution rather than reading the filesystem again. `README.md`
 * carries why both rules are shaped this way.
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  DEMO_FLOW,
  GENERATED_MARKER,
  MOUNT,
  NODE_FLOOR,
  PROVIDER_KEYS,
  SUPPORTED_PACKAGE_MANAGERS,
} from "./constants.mjs";
import { declaredFsdDependencies, moduleSystemOf, nodeStripsTypes } from "./next-project.mjs";
import { readIfPresent } from "./fs-util.mjs";
import {
  appRootAbsolute,
  chooseRouteExtension,
  classifyHost,
  classifySlot,
  resolveDevCommand,
  resolveMountPath,
  resolveNextConfig,
  resolveNextSettings,
  scanRouteSlots,
} from "./next-project.mjs";
import { inspectRegistry, resolveLoadedConfig } from "./fsdev-config.mjs";
import { accountDelimiters } from "./prose-files.mjs";
import { resolveSecretFiles, resolveSecrets } from "./secrets.mjs";
import { childProjects, declaresWorkspace, resolvePackageManager, resolveWorkspaceRoot } from "./roots.mjs";
import { displayPath, repositoryRoot } from "./fs-util.mjs";

/** The report's shape version. The skill is the consumer and there is no compiler between them. */
export const REPORT_SCHEMA = "fsd-detect/1";

/** Does this Node meet the floor a wired-up project needs? Compared numerically, never as a string. */
export function meetsNodeFloor(version, floor = NODE_FLOOR) {
  const parse = (v) => v.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [aMajor, aMinor, aPatch] = parse(version);
  const [bMajor, bMinor, bPatch] = parse(floor);
  if (aMajor !== bMajor) return aMajor > bMajor;
  if (aMinor !== bMinor) return aMinor > bMinor;
  return aPatch >= bPatch;
}

/**
 * What a developer is told when their config is past what this reads.
 *
 * **This is scope, not a defect.** The detector handles simple projects; anything else is an
 * agent's job. So the message says that plainly rather than implying we tried and failed — and it
 * gives two ways forward, because being turned away has to be cheap.
 */
const HANDOFF =
  "This detector only reads a few simple config shapes on purpose — a plain object exported " +
  "directly, or assigned to a name and exported. Yours is past that, and guessing at it is how a " +
  "run scaffolds into the wrong place.";

const BY_HAND =
  "Two ways forward: ask a coding agent to wire FSD in for you (it can read your config properly), " +
  "or follow https://flow-state.dev/docs/getting-started/existing-project to do it by hand. " +
  "Nothing has been written.";

/** One refusal: a machine-readable code, what a developer is told, and what fixes it. */
function refusal(code, message, remediation) {
  return { code, message, remediation };
}

/**
 * Build the whole report for a directory. Reads only.
 *
 * `providerKey` is deliberately optional and deliberately *last*: detection resolves **all three**
 * candidate provider keys before anyone is asked which one they want, so every refusal that does
 * not depend on the answer fires before the question. Passing one afterwards narrows resolution 10
 * without re-reading anything.
 */
export function buildReport(targetDir, { env = process.env, nodeVersion = process.version, providerKey = null } = {}) {
  const writeRoot = targetDir;
  const refusals = [];

  // --- The floor: a directory has to be a project before any of this means anything ------------
  if (!existsSync(join(writeRoot, "package.json"))) {
    refusals.push(
      refusal(
        "not-a-project",
        `There is no package.json in ${writeRoot}, so this is a folder rather than a project.`,
        "Run this in the directory whose package.json you want FSD added to.",
      ),
    );
  }

  // --- Resolutions 1 and 2: the roots ----------------------------------------------------------
  const workspace = resolveWorkspaceRoot(writeRoot);
  const repository = repositoryRoot(writeRoot);
  const host = classifyHost(writeRoot);
  const declaration = declaresWorkspace(writeRoot);
  const children = childProjects(writeRoot);

  // A directory that declares a workspace **and** is not itself a host is a container of hosts,
  // and nothing in it says which one the developer wants FSD in. A root that satisfies the host
  // rule is a host: keying the refusal on the marker alone tells that developer to rerun inside a
  // child app that may not exist.
  const isContainer =
    host.value === "node" && (declaration.declares || children.length > 1) && children.length > 0;
  if (isContainer) {
    refusals.push(
      refusal(
        "workspace-root",
        `${writeRoot} looks like a container of projects${declaration.via === null ? "" : ` (${declaration.via})`}, not a project FSD would go into. ` +
          `Projects found beneath it: ${children.join(", ")}.`,
        "Run this again inside the app you mean. Nothing here picks one for you.",
      ),
    );
  }

  // --- Resolution 3: the package manager -------------------------------------------------------
  const packageManager = resolvePackageManager(writeRoot, workspace.path);
  if (packageManager.value === "ambiguous") {
    refusals.push(
      refusal(
        "package-manager-ambiguous",
        `Lockfiles in this project disagree about which package manager it uses: ` +
          `${packageManager.lockfiles.map((l) => l.path).join(", ")}. Installing through the wrong ` +
          `one would rewrite the wrong lockfile.`,
        `Delete the stale lockfile, or declare the manager: "packageManager": "pnpm@9.x" in package.json.`,
      ),
    );
  } else if (packageManager.value === "undeclared") {
    refusals.push(
      refusal(
        "package-manager-undeclared",
        "Nothing in this project or its workspace says which package manager it uses — no " +
          "packageManager field and no lockfile.",
        `Add a "packageManager" field to package.json, then ask again.`,
      ),
    );
  } else if (packageManager.value === "unsupported") {
    refusals.push(
      refusal(
        "package-manager-unsupported",
        `This project declares ${packageManager.manager}, which has no command forms here.`,
        `Supported today: ${SUPPORTED_PACKAGE_MANAGERS.join(", ")}.`,
      ),
    );
  }

  // --- The host ---------------------------------------------------------------------------------
  if (host.value === "next-unsupported") {
    const reasons = [];
    if (host.failed.includes("app-router")) {
      reasons.push(
        "App Router — the route adapter builds App Router route exports, and there is no Pages Router equivalent yet",
      );
    }
    if (host.failed.includes("next-version") || host.failed.includes("next-version-unreadable")) {
      reasons.push(
        `Next 15 or later — the FSD Next adapter requires it, so the install would fail partway (found ${host.nextRange})`,
      );
    }
    refusals.push(
      refusal(
        "next-unsupported",
        `I can't add FSD to this project yet, and I've written nothing. Two things would need to be true: ${reasons.join("; ")}.`,
        "https://flow-state.dev/docs/getting-started/existing-project has the by-hand path.",
      ),
    );
  }

  // --- Resolutions 4b, 5, 6, 7: everything downstream of Next's own config ----------------------
  const nextConfig = host.value === "next" ? resolveNextConfig(writeRoot) : null;
  const settings = nextConfig === null ? null : resolveNextSettings(nextConfig.path);
  const routeExtension =
    settings === null ? null : chooseRouteExtension(settings.pageExtensions.enabled);
  const mountPath = settings === null ? null : resolveMountPath(settings.basePath.value);

  if (settings !== null && !settings.pageExtensions.readable) {
    refusals.push(
      refusal(
        "config-past-what-i-read",
        `I can't read ${displayPath(nextConfig.path, writeRoot)} safely — ${settings.pageExtensions.why ?? "pageExtensions is not a plain array of strings"}.\n` +
          HANDOFF,
        BY_HAND,
      ),
    );
  } else if (settings !== null && routeExtension === null) {
    refusals.push(
      refusal(
        "page-extensions-exclude-ts",
        `pageExtensions in ${nextConfig.path} enables ${settings.pageExtensions.enabled.join(", ")}, ` +
          `so a route file I can write would not be a route.`,
        "Add ts or tsx to pageExtensions.",
      ),
    );
  }
  if (settings !== null && !settings.basePath.readable) {
    refusals.push(
      refusal(
        "config-past-what-i-read",
        `I can't read ${displayPath(nextConfig.path, writeRoot)} safely — ${settings.basePath.why ?? "basePath is not a plain string"}, so I can't tell where the mount would answer.\n` +
          HANDOFF,
        BY_HAND,
      ),
    );
  }

  const appRootAbs = appRootAbsolute(writeRoot, host.appRoot);
  const routeSlots =
    host.value === "next" && appRootAbs !== null
      ? scanRouteSlots(appRootAbs, settings?.pageExtensions.enabled ?? null)
      : [];
  const slotVerdicts = routeSlots.map((slot) => ({ ...slot, ...classifySlot(slot, routeExtension) }));
  for (const slot of slotVerdicts) {
    // Paths a developer reads are relative to the directory they pointed this at. The report's
    // structured fields keep the absolute ones, which is what the skill acts on.
    const here = (paths) => paths.map((path) => displayPath(path, writeRoot)).join(", ");
    if (slot.verdict === "refuse-foreign") {
      refusals.push(
        refusal(
          "route-slot-occupied",
          `Something already answers at ${displayPath(slot.slot, writeRoot)}: ` +
            `${here(slot.occupants.map((o) => o.path))}. Next treats any enabled extension at that ` +
            `slot as the same route, so writing mine would either replace your endpoint or silently ` +
            `never answer.`,
          "Move or remove that file, then ask again.",
        ),
      );
    } else if (slot.verdict === "refuse-stale") {
      refusals.push(
        refusal(
          "route-slot-stale",
          `${here(slot.occupants.map((o) => o.path))} is a file I wrote at an extension this ` +
            `project no longer enables. It is not a route today, and it becomes a second handler in ` +
            `the same slot if pageExtensions widens again.`,
          "Delete it — I never delete files I wrote.",
        ),
      );
    }
  }

  // --- The dev command, and the refusal scoped to the topology that spends it -------------------
  const devCommand = resolveDevCommand(writeRoot, host.value);
  // A container is reported as `workspace-root`, never as `node`. The refusal alone is not
  // enough: a report that still *says* `node` hands the skill a host classification for a
  // directory that has none, and the second-process branch is exactly what would then get
  // scaffolded at the top of somebody's repository.
  const hostValue = isContainer ? "workspace-root" : host.value;
  const topology = hostValue === "next" ? "mounted-route" : hostValue === "node" ? "second-process" : null;
  if (topology === "mounted-route" && devCommand.script === null) {
    refusals.push(
      refusal(
        "no-dev-script",
        "I can't find the script that starts this app, and the next steps for a mounted route print " +
          "your own dev command and the URL it serves.",
        "Name your dev script in package.json, then ask again.",
      ),
    );
  }

  // --- Resolutions 8 and 8b --------------------------------------------------------------------
  // **The path the run would write, checked directly.** The registry saying our demo kind is free
  // is a statement about the config, not about the file — a project can own
  // `flows/hello/flow.mts` without registering it, and the run would then overwrite source the
  // developer wrote. Checking the registry for this is checking a proxy for the thing, the same
  // gap the dev-script refusal had.
  const demoFlowPath = join(writeRoot, DEMO_FLOW.modulePath.replace(/^\.\//, ""));
  const demoFlowSource = readIfPresent(demoFlowPath);
  if (demoFlowSource !== null && !demoFlowSource.includes(GENERATED_MARKER)) {
    refusals.push(
      refusal(
        "demo-flow-path-occupied",
        `${displayPath(demoFlowPath, writeRoot)} already exists and is not a file I wrote, so the ` +
          `demo flow would overwrite it.`,
        "Move or rename that file, then ask again.",
      ),
    );
  }

  const fsdevConfig = resolveLoadedConfig(writeRoot);
  const registry = fsdevConfig.winnerIsOurs
    ? { extendable: true, entries: [], demoKind: "free", ourEntry: null }
    : inspectRegistry(fsdevConfig.winner);
  if (registry.demoKind === "taken") {
    refusals.push(
      refusal(
        "demo-kind-taken",
        `Your config already registers a flow of kind "${DEMO_FLOW.kind}" ` +
          `(${registry.foreignWithOurKind.map((e) => e.specifier).join(", ")}). A kind is a namespace, ` +
          `and registering mine over yours would throw at load.`,
        "Rename one of them, and nothing has been written.",
      ),
    );
  }

  // --- Resolutions 9 and 10 --------------------------------------------------------------------
  const secrets = resolveSecrets(writeRoot, host.value, env);
  const secretFiles = resolveSecretFiles(writeRoot, secrets, { providerKey });
  for (const file of secretFiles) {
    if (file.tracked) {
      refusals.push(
        refusal(
          "secret-file-tracked",
          `${file.path} is committed to this repository, so I am not putting a secret in it. ` +
            `(${file.reasons.join("; ")})`,
          `git rm --cached ${file.path}`,
        ),
      );
    }
  }

  // --- The prose files -------------------------------------------------------------------------
  const ignoreFile = accountDelimiters(join(writeRoot, ".gitignore"));
  const instructionsFile = accountDelimiters(join(writeRoot, "AGENTS.md"));
  for (const file of [ignoreFile, instructionsFile]) {
    if (file.verdict !== "malformed") continue;
    refusals.push(
      refusal(
        "delimiters-malformed",
        `${file.path} carries FSD delimiters that are not one balanced pair — ` +
          `${file.delimiters.map((d) => `${d.kind} on line ${d.line}`).join(", ")}. Replacing between ` +
          `them would delete content you wrote.`,
        "Leave exactly one start and one matching end, or remove both.",
      ),
    );
  }

  // --- The runtime floor ------------------------------------------------------------------------
  const runtimeOk = meetsNodeFloor(nodeVersion);
  if (!runtimeOk) {
    refusals.push(
      refusal(
        "node-below-floor",
        `This is Node ${nodeVersion.replace(/^v/, "")}, and a wired-up project needs ${NODE_FLOOR} — ` +
          `the CLI loads the TypeScript config with native type stripping.`,
        `Upgrade to Node ${NODE_FLOOR} or later, then ask again.`,
      ),
    );
  }

  return {
    schema: REPORT_SCHEMA,
    target: writeRoot,
    runtime: {
      node: nodeVersion.replace(/^v/, ""),
      floor: NODE_FLOOR,
      meetsFloor: runtimeOk,
      typescriptSupport: nodeStripsTypes(),
    },
    roots: {
      writeRoot,
      workspaceRoot: workspace.path,
      workspaceRootFrom: workspace.source,
      repository,
      childProjects: children,
    },
    host: {
      value: hostValue,
      nextRange: host.nextRange,
      nextMajor: host.nextMajor,
      router: host.router,
      failed: host.failed,
      topology,
    },
    appRoot: { path: host.appRoot, absolute: appRootAbs, pagesDir: host.pagesDir },
    packageManager,
    nextConfig,
    routeExtension: {
      value: routeExtension,
      enabled: settings?.pageExtensions.enabled ?? null,
      source: settings?.pageExtensions.source ?? null,
      readable: settings?.pageExtensions.readable ?? null,
    },
    mount: {
      path: mountPath,
      basePath: settings?.basePath.value ?? null,
      basePathReadable: settings?.basePath.readable ?? null,
      bare: MOUNT.path,
    },
    routeSlots: slotVerdicts,
    devCommand,
    moduleSystem: moduleSystemOf(writeRoot),
    fsdevConfig: { ...fsdevConfig, registry },
    // Every provider key by name plus the demo token, each `absent`/`empty`/`non-empty` with the
    // path that decided it, per runtime. Never merged into one "is the credential configured".
    secrets,
    providerKeys: [...PROVIDER_KEYS],
    secretFiles,
    ignoreFile,
    instructionsFile,
    declaredFsdDependencies: declaredFsdDependencies(writeRoot),
    refusals,
  };
}
