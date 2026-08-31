/**
 * Resolutions 1–3: the workspace root, the write root, and the package manager.
 *
 * Every case here is one a real repository produces. The workspace ones in particular are not
 * exotic: an app inside a pnpm workspace with the lockfile at the repository root is the ordinary
 * layout, and a stale `package-lock.json` beside an app is common enough that resolving it wrong
 * installs through the wrong manager in a project people actually have.
 */
import { afterAll, describe, expect, it } from "vitest";
import { buildReport } from "../skills/install-fsd/detect/report.mjs";
import {
  CONTAINER_SCAN_DEPTH,
  childProjects,
  resolvePackageManager,
  resolveWorkspaceRoot,
} from "../skills/install-fsd/detect/roots.mjs";
import { cleanupTrees, initGit, makeTree, manifest, nextManifest } from "./helpers.mjs";
import { join } from "node:path";

afterAll(cleanupTrees);

/** Refusal codes on a report, for a test that cares which one fired rather than how it read. */
const codes = (report) => report.refusals.map((r) => r.code);

describe("the workspace root is the outermost declaration, not the nearest signal", () => {
  it("stops at a pnpm-workspace.yaml above the app", () => {
    const root = makeTree({
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
      "package.json": manifest({ packageManager: "pnpm@9.0.0" }),
      "apps/web/package.json": nextManifest(),
      "apps/web/app/page.tsx": "export default function Page() { return null }\n",
    });
    expect(resolveWorkspaceRoot(join(root, "apps/web")).path).toBe(root);
  });

  it("a lockfile is not a workspace marker", () => {
    // Bounding the search on the nearest package-manager signal is what let a stale lockfile
    // beside an app become "the root": the search then never reaches the real declaration.
    const root = makeTree({
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
      "package.json": manifest({ packageManager: "pnpm@9.0.0" }),
      "apps/web/package.json": nextManifest(),
      "apps/web/package-lock.json": "{}\n",
    });
    expect(resolveWorkspaceRoot(join(root, "apps/web")).path).toBe(root);
  });

  it("stops at the repository, so an unrelated outer workspace is not inherited", () => {
    // A workspace cannot span repositories. Without this bound, a project that happens to sit
    // inside somebody else's checkout inherits their `pnpm-workspace.yaml` — and the manager then
    // resolves from a declaration belonging to a project the developer has nothing to do with.
    // Found by running detection on a real path rather than on a fixture.
    const outer = makeTree({
      "pnpm-workspace.yaml": "packages:\n  - '*'\n",
      "package.json": manifest({ packageManager: "pnpm@9.0.0" }),
      "vendored/package.json": manifest({ packageManager: "npm@10.0.0" }),
    });
    const inner = join(outer, "vendored");
    initGit(inner);
    expect(resolveWorkspaceRoot(inner).path).toBe(inner);
    expect(resolvePackageManager(inner, resolveWorkspaceRoot(inner).path).value).toBe("npm");
  });

  it("falls back to the git repository when nothing declares a workspace", () => {
    const root = makeTree({ "package.json": manifest(), "apps/web/package.json": manifest() }, { git: true });
    expect(resolveWorkspaceRoot(join(root, "apps/web")).path).toBe(root);
  });
});

describe("package-manager precedence, one pass over the whole chain", () => {
  it("a packageManager field beats a lockfile that disagrees with it", () => {
    const root = makeTree({
      "package.json": manifest({ packageManager: "pnpm@9.0.0" }),
      "package-lock.json": "{}\n",
    });
    const resolved = resolvePackageManager(root, root);
    expect(resolved.value).toBe("pnpm");
    expect(resolved.ignoringLockfiles).toEqual([join(root, "package-lock.json")]);
  });

  it("a stale lockfile inside a workspace app does not decide the manager", () => {
    // Under a workspace search bounded by the nearest package-manager signal, `apps/web` becomes
    // its own workspace root, the root declaration is never seen, and this resolves npm — then
    // installs with it, writing a package-lock.json into a pnpm workspace.
    const root = makeTree({
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
      "package.json": manifest({ packageManager: "pnpm@9.0.0" }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "apps/web/package.json": nextManifest(),
      "apps/web/package-lock.json": "{}\n",
    });
    const app = join(root, "apps/web");
    expect(resolvePackageManager(app, resolveWorkspaceRoot(app).path).value).toBe("pnpm");
  });

  it("the nearest field wins among fields, so an app may override its workspace", () => {
    const root = makeTree({
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
      "package.json": manifest({ packageManager: "pnpm@9.0.0" }),
      "apps/web/package.json": nextManifest({ packageManager: "npm@10.0.0" }),
    });
    const app = join(root, "apps/web");
    expect(resolvePackageManager(app, resolveWorkspaceRoot(app).path).value).toBe("npm");
  });

  it("a single lockfile with no field resolves to that manager", () => {
    const root = makeTree({ "package.json": manifest(), "yarn.lock": "" });
    expect(resolvePackageManager(root, root).value).toBe("yarn");
  });

  it("two lockfiles with no field are ambiguous and refuse, naming both", () => {
    const root = makeTree({
      "package.json": manifest(),
      "pnpm-lock.yaml": "",
      "package-lock.json": "{}\n",
    });
    const report = buildReport(root);
    expect(codes(report)).toContain("package-manager-ambiguous");
    const message = report.refusals.find((r) => r.code === "package-manager-ambiguous").message;
    expect(message).toContain("pnpm-lock.yaml");
    expect(message).toContain("package-lock.json");
  });

  it("two lockfiles with a field are not ambiguous, and the report says what it is ignoring", () => {
    const root = makeTree({
      "package.json": manifest({ packageManager: "pnpm@9.0.0" }),
      "pnpm-lock.yaml": "",
      "package-lock.json": "{}\n",
    });
    const report = buildReport(root);
    expect(codes(report)).not.toContain("package-manager-ambiguous");
    expect(report.packageManager.value).toBe("pnpm");
    expect(report.packageManager.ignoringLockfiles).toEqual([join(root, "package-lock.json")]);
  });

  it("nothing declared and no lockfile anywhere refuses as undeclared", () => {
    const root = makeTree({ "package.json": manifest() });
    const report = buildReport(root);
    expect(codes(report)).toContain("package-manager-undeclared");
  });

  it("stays undeclared with npm_config_user_agent set to an npm agent", () => {
    // The fixture that fails if the old fallback is ever restored. Its failure mode in the field
    // is `npm add` fabricating a package-lock.json in a pnpm project.
    const root = makeTree({ "package.json": manifest() });
    const report = buildReport(root, {
      env: { npm_config_user_agent: "npm/10.9.7 node/v22.22.2 linux x64 workspaces/false" },
    });
    expect(codes(report)).toContain("package-manager-undeclared");
  });

  it("a manager outside npm/pnpm/yarn refuses, naming what is supported", () => {
    const root = makeTree({ "package.json": manifest({ packageManager: "bun@1.2.0" }) });
    const report = buildReport(root);
    expect(codes(report)).toContain("package-manager-unsupported");
    const refusal = report.refusals.find((r) => r.code === "package-manager-unsupported");
    expect(refusal.message).toContain("bun");
    expect(refusal.remediation).toContain("pnpm");
  });
});

describe("a container of projects refuses; a repository root that is also a host does not", () => {
  it("refuses a workspace root rather than classifying it as a Node host", () => {
    // The bug this catches is silent: a workspace root has no `next` dependency, so the plain
    // host rule returns `node` and the run scaffolds a second-process setup at the top of the
    // repository.
    const root = makeTree({
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
      "package.json": manifest({ packageManager: "pnpm@9.0.0" }),
      "apps/web/package.json": nextManifest(),
      "apps/api/package.json": manifest(),
    });
    const report = buildReport(root);
    expect(codes(report)).toContain("workspace-root");
    expect(report.host.value).not.toBe("node");
  });

  it("refuses a container declared with a workspaces array too, not just pnpm's file", () => {
    const root = makeTree({
      "package.json": manifest({ workspaces: ["apps/*"], packageManager: "npm@10.0.0" }),
      "apps/web/package.json": nextManifest(),
      "apps/api/package.json": manifest(),
    });
    expect(codes(buildReport(root))).toContain("workspace-root");
  });

  it("proceeds when the repository root declares workspaces AND is itself the host", () => {
    // A marker-only refusal sends this developer to a child app that does not exist.
    const root = makeTree({
      "package.json": nextManifest({ workspaces: ["packages/*"], packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": "export default function Page() { return null }\n",
      "packages/ui/package.json": manifest(),
    });
    const report = buildReport(root);
    expect(codes(report)).not.toContain("workspace-root");
    expect(report.host.value).toBe("next");
    expect(report.roots.writeRoot).toBe(report.roots.workspaceRoot);
  });
});

describe("the container scan reaches as deep as it declares", () => {
  it("refuses a workspace whose members are nested deeper than two levels", () => {
    // The hand-unrolled two-level walk missed this shape, so the container refusal was defeated by
    // depth alone and the directory reported as a plain Node host — which scaffolds a
    // second-process setup at the top of the repository.
    const root = makeTree({
      "pnpm-workspace.yaml": "packages:\n  - 'packages/**'\n",
      "package.json": manifest({ packageManager: "pnpm@9.0.0" }),
      "packages/group/web/package.json": nextManifest(),
      "packages/group/api/package.json": manifest(),
    });
    const report = buildReport(root);
    expect(codes(report)).toContain("workspace-root");
    expect(report.host.value).toBe("workspace-root");
  });

  it("stops at the declared depth rather than searching the whole tree", () => {
    // The bound is real — this is a look, not a search — so it is asserted at its boundary rather
    // than left as whatever the loop happens to do.
    expect(CONTAINER_SCAN_DEPTH).toBeGreaterThanOrEqual(3);
    const root = makeTree({
      "package.json": manifest({ packageManager: "pnpm@9.0.0" }),
      "a/b/c/d/e/f/package.json": manifest(),
    });
    expect(childProjects(root)).toEqual([]);
  });

  it("does not treat a project's own subdirectories as more members", () => {
    const root = makeTree({
      "package.json": manifest({ packageManager: "pnpm@9.0.0" }),
      "apps/web/package.json": nextManifest(),
      "apps/web/vendor/thing/package.json": manifest(),
    });
    expect(childProjects(root)).toEqual([join(root, "apps/web")]);
  });
});

describe("a workspace app writes only beneath itself", () => {
  it("resolves the manager from the root declaration and keeps every path under the app", () => {
    const root = makeTree({
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
      "package.json": manifest({ packageManager: "pnpm@9.0.0" }),
      "pnpm-lock.yaml": "",
      "apps/web/package.json": nextManifest(),
      "apps/web/src/app/page.tsx": "export default function Page() { return null }\n",
    });
    const app = join(root, "apps/web");
    const report = buildReport(app);
    expect(report.packageManager.value).toBe("pnpm");
    expect(report.roots.writeRoot).toBe(app);
    expect(report.roots.workspaceRoot).toBe(root);
    // Every path the report points the run at sits beneath the write root — asserted as a prefix
    // check over the whole set, since one wrong path is the whole defect.
    const written = [
      ...report.secretFiles.map((f) => f.path),
      report.ignoreFile.path,
      report.instructionsFile.path,
      ...report.routeSlots.map((s) => s.slot),
    ];
    for (const path of written) expect(path.startsWith(app)).toBe(true);
    // And the lockfile it will rewrite is named by path, because that is different news when it
    // is two directories above the app the developer was working in.
    expect(report.packageManager.lockfiles.map((l) => l.path)).toContain(join(root, "pnpm-lock.yaml"));
  });
});
