/**
 * The host classification, and everything downstream of Next's own resolution algorithms —
 * resolutions 4, 4b, 5, 6 and 7.
 *
 * The failures these guard against are silent. Writing a root `app/` into a project laid out
 * under `src/app` does not extend their application, it changes which directory Next treats as
 * the app; a `route.ts` in a project that configured `pageExtensions: ['jsx','js']` is not a
 * route at all; and a mount under a `basePath` answers somewhere other than where we said.
 */
import { afterAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { buildReport } from "../skills/install-fsd/detect/report.mjs";
import {
  chooseRouteExtension,
  classifyHost,
  needsRunSeparator,
  nodeStripsTypes,
  resolveAppRoot,
  resolveNextConfig,
  resolveNextSettings,
} from "../skills/install-fsd/detect/next-project.mjs";
import { cleanupTrees, makeTree, manifest, nextManifest } from "./helpers.mjs";
import { renderNextSteps } from "../../../packages/cli/src/next-steps.ts";

afterAll(cleanupTrees);

const codes = (report) => report.refusals.map((r) => r.code);
const page = "export default function Page() { return null }\n";

describe("the host is narrower than 'a next dependency'", () => {
  it("classifies an App Router project on Next 15 as next", () => {
    const root = makeTree({ "package.json": nextManifest(), "app/page.tsx": page });
    expect(classifyHost(root).value).toBe("next");
  });

  it("refuses a Pages Router project rather than degrading it to node", () => {
    // Degrading would be worse than guessing: it writes a second-process setup into a Next app.
    const root = makeTree({ "package.json": nextManifest(), "pages/index.tsx": page });
    const host = classifyHost(root);
    expect(host.value).toBe("next-unsupported");
    expect(host.failed).toContain("app-router");
    const report = buildReport(root);
    expect(codes(report)).toContain("next-unsupported");
    expect(report.host.value).not.toBe("node");
    expect(report.refusals.find((r) => r.code === "next-unsupported").message).toContain("App Router");
  });

  it("refuses Next below the adapters' declared peer range, naming the version", () => {
    const root = makeTree({
      "package.json": manifest({ dependencies: { next: "14.2.5" }, scripts: { dev: "next dev" } }),
      "app/page.tsx": page,
    });
    const host = classifyHost(root);
    expect(host.value).toBe("next-unsupported");
    expect(host.failed).toContain("next-version");
    expect(buildReport(root).refusals.find((r) => r.code === "next-unsupported").message).toContain("14.2.5");
  });

  it("classifies a project with no next dependency as node, down to the minimal floor", () => {
    // An empty directory with a package.json and a packageManager field is a valid target.
    const root = makeTree({ "package.json": manifest({ packageManager: "npm@10.0.0" }) });
    expect(classifyHost(root).value).toBe("node");
    const report = buildReport(root);
    expect(report.host.topology).toBe("second-process");
    expect(report.refusals).toEqual([]);
  });
});

describe("the app root is detected the way Next detects it, never assumed", () => {
  it("resolves a src/ layout to src/app", () => {
    const root = makeTree({ "package.json": nextManifest(), "src/app/page.tsx": page });
    expect(resolveAppRoot(root).appRoot).toBe(join("src", "app"));
  });

  it("resolves a root layout to app", () => {
    const root = makeTree({ "package.json": nextManifest(), "app/page.tsx": page });
    expect(resolveAppRoot(root).appRoot).toBe("app");
  });

  it("prefers root over src/ when both exist, the way findDir does", () => {
    const root = makeTree({
      "package.json": nextManifest(),
      "app/page.tsx": page,
      "src/app/page.tsx": page,
    });
    expect(resolveAppRoot(root).appRoot).toBe("app");
  });

  it("puts every path it would write beneath the detected app root, and proposes no root app/", () => {
    // The assertion that would have caught the shadowing bug: a root `app/` in a src/-laid-out
    // project changes which directory Next treats as the app, and every route they had stops
    // being served — silently on Next 15, as a hard build error on Next 16 with a src/pages.
    const root = makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "src/app/page.tsx": page,
    });
    const report = buildReport(root);
    expect(report.appRoot.path).toBe(join("src", "app"));
    for (const slot of report.routeSlots) {
      expect(slot.slot.startsWith(join(root, "src", "app"))).toBe(true);
      expect(slot.slot.startsWith(join(root, "app"))).toBe(false);
    }
  });
});

describe("pageExtensions and basePath come from the config Next would load", () => {
  it("takes the .js when a .js and a .ts disagree", () => {
    // A project with both is served by the .js, so parsing the .ts reads settings that never apply.
    const root = makeTree({
      "package.json": nextManifest(),
      "app/page.tsx": page,
      "next.config.js": "module.exports = { basePath: '/from-js' }\n",
      "next.config.ts": "export default { basePath: '/from-ts' }\n",
    });
    const config = resolveNextConfig(root, { typescriptSupport: true });
    expect(config.path).toBe(join(root, "next.config.js"));
    expect(resolveNextSettings(config.path).basePath.value).toBe("/from-js");
  });

  it("inherits an ancestor's config, because findUp walks upward", () => {
    // An app with no config of its own is not an app with Next's defaults.
    const root = makeTree({
      "next.config.js": "module.exports = { basePath: '/portal' }\n",
      "package.json": manifest({ workspaces: ["apps/*"] }),
      "apps/web/package.json": nextManifest(),
      "apps/web/app/page.tsx": page,
    });
    const config = resolveNextConfig(join(root, "apps/web"));
    expect(config.path).toBe(join(root, "next.config.js"));
  });

  it("detects TypeScript support from the string Node actually reports, not from `=== true`", () => {
    // `process.features.typescript` is `"strip"` / `"transform"`, never `true`. A strict-equality
    // check is false on every Node that supports stripping, so `next.config.mts` was dropped from
    // the candidate list on exactly the machines where Next itself accepts it. Both tests of that
    // check passed the value explicitly, so the default was never exercised — this one drives it.
    expect(typeof process.features.typescript === "string" || process.features.typescript === false).toBe(true);
    expect(nodeStripsTypes()).toBe(Boolean(process.features.typescript));

    const root = makeTree({
      "package.json": nextManifest(),
      "app/page.tsx": page,
      "next.config.mts": "export default { basePath: '/mts' }\n",
    });
    // No `typescriptSupport` argument: this is the production path.
    const config = resolveNextConfig(root);
    if (process.features.typescript) {
      expect(config.path).toBe(join(root, "next.config.mts"));
      expect(buildReport(root).mount.path).toBe("/mts/api/flows");
    } else {
      expect(config.path).toBe(null);
    }
  });

  it("treats next.config.mts as a candidate only when the running Node reports TypeScript support", () => {
    const root = makeTree({
      "package.json": nextManifest(),
      "app/page.tsx": page,
      "next.config.mts": "export default { basePath: '/mts' }\n",
    });
    expect(resolveNextConfig(root, { typescriptSupport: true }).path).toBe(join(root, "next.config.mts"));
    expect(resolveNextConfig(root, { typescriptSupport: false }).path).toBe(null);
  });
});

describe("the accepted config shapes are a whitelist, and everything else is handed off", () => {
  const withConfig = (contents) =>
    makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
      "next.config.js": contents,
    });

  it.each([
    ["module.exports = { … }", "module.exports = { basePath: '/portal' }\n"],
    ["export default { … }", "export default { basePath: '/portal' }\n"],
    ["const NAME = { … }; export default NAME", "const cfg = { basePath: '/portal' }\nexport default cfg\n"],
    ["const NAME = { … }; module.exports = NAME", "const cfg = { basePath: '/portal' }\nmodule.exports = cfg\n"],
  ])("accepts %s", (_name, contents) => {
    const report = buildReport(withConfig(contents));
    expect(codes(report)).not.toContain("config-past-what-i-read");
    expect(report.mount.path).toBe("/portal/api/flows");
  });

  it.each([
    ["a wrapper call", "const withMDX = require('@next/mdx')()\nmodule.exports = withMDX({ basePath: '/portal' })\n"],
    ["a function export", "module.exports = () => ({ basePath: '/portal' })\n"],
    ["an async function export", "export default async function config() { return { basePath: '/x' } }\n"],
    ["a runtime choice", "const a = { basePath: '/a' }\nconst b = { basePath: '/b' }\nmodule.exports = process.env.CI ? a : b\n"],
    ["a spread", "module.exports = { ...base, basePath: '/portal' }\n"],
    ["two exports", "export default { basePath: '/a' }\nmodule.exports = { basePath: '/b' }\n"],
  ])("hands off %s, and says so in the developer's terms", (_name, contents) => {
    // Out of scope by design: the detector is for simple projects, and a config past that is an
    // agent's job. A spread is the interesting one — the object literal is right there, and it is
    // still refused, because what it spreads in could set anything.
    const report = buildReport(withConfig(contents));
    const refusal = report.refusals.find((r) => r.code === "config-past-what-i-read");
    expect(refusal, `${_name} should have been handed off`).toBeDefined();
    expect(refusal.message).toContain("only reads a few simple config shapes on purpose");
    expect(refusal.remediation).toContain("ask a coding agent");
    expect(refusal.remediation).toContain("Nothing has been written");
  });

  it("still applies Next's documented default when there is no config at all", () => {
    // The whitelist narrows what we READ, not what we accept as a project. No config is not an
    // unreadable config.
    const root = makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
    });
    const report = buildReport(root);
    expect(codes(report)).not.toContain("config-past-what-i-read");
    expect(report.routeExtension.value).toBe("ts");
    expect(report.mount.path).toBe("/api/flows");
  });
});

describe("the route extension follows pageExtensions", () => {
  it("defaults to ts with no next.config", () => {
    const settings = resolveNextSettings(null);
    expect(settings.pageExtensions.enabled).toEqual(["tsx", "ts", "jsx", "js"]);
    expect(chooseRouteExtension(settings.pageExtensions.enabled)).toBe("ts");
  });

  it("proceeds with ts when mdx is added to the default set", () => {
    const root = makeTree({
      "package.json": nextManifest(),
      "app/page.tsx": page,
      "next.config.js": "module.exports = { pageExtensions: ['tsx','ts','jsx','js','mdx'] }\n",
    });
    expect(buildReport(root).routeExtension.value).toBe("ts");
  });

  it("refuses a project that configured ts and tsx out of existence", () => {
    // Both mount files would land, nothing would error, and /api/flows would not exist.
    const root = makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
      "next.config.js": "module.exports = { pageExtensions: ['jsx','js'] }\n",
    });
    expect(codes(buildReport(root))).toContain("page-extensions-exclude-ts");
  });

  it("refuses a pageExtensions we cannot read statically rather than guessing", () => {
    const root = makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
      "next.config.js": "module.exports = { pageExtensions: buildExtensions() }\n",
    });
    const report = buildReport(root);
    expect(codes(report)).toContain("config-past-what-i-read");
    expect(report.routeExtension.readable).toBe(false);
  });
});

describe("the mount URL carries basePath", () => {
  it("prefixes every printed and probed path", () => {
    // Next's router tests the prefix and returns BEFORE route matching, so the bare path is not
    // merely unmatched — it is rejected upstream of the matcher.
    const root = makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
      "next.config.ts": "export default { basePath: '/portal' }\n",
    });
    const report = buildReport(root);
    expect(report.mount.path).toBe("/portal/api/flows");
    expect(report.mount.basePath).toBe("/portal");
  });

  it("answers at the bare path with no basePath — the negative control", () => {
    const root = makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
    });
    expect(buildReport(root).mount.path).toBe("/api/flows");
  });

  it("ignores a commented-out setting, in both comment syntaxes", () => {
    // Root B. The first textual match won, so a `// basePath: '/old'` the developer had already
    // abandoned decided the mount URL — and every printed and probed path 404'd. One walker, one
    // anchoring rule; `pageExtensions` had the identical bug one file over.
    const root = makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
      "next.config.js": [
        "// basePath: '/old'",
        "/* pageExtensions: ['jsx','js'] */",
        "module.exports = { basePath: '/portal' }",
        "",
      ].join("\n"),
    });
    const report = buildReport(root);
    expect(report.mount.path).toBe("/portal/api/flows");
    expect(report.routeExtension.value).toBe("ts");
    expect(codes(report)).not.toContain("page-extensions-exclude-ts");
  });

  it("ignores a setting named inside a string, and reads one whose value contains a comment marker", () => {
    const root = makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
      "next.config.js": [
        "const help = 'set basePath: /nope to change the prefix'",
        "module.exports = { basePath: '/a//b' }",
        "",
      ].join("\n"),
    });
    expect(buildReport(root).mount.path).toBe("/a//b/api/flows");
  });

  it("refuses a setting assigned twice rather than picking one", () => {
    // Two live assignments and nothing says which object is exported. Reporting the first is the
    // same guess the commented-out case was.
    const root = makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
      "next.config.js": [
        "const dev = { basePath: '/dev' }",
        "const prod = { basePath: '/prod' }",
        "module.exports = process.env.CI ? prod : dev",
        "",
      ].join("\n"),
    });
    const report = buildReport(root);
    expect(codes(report)).toContain("config-past-what-i-read");
    expect(report.mount.basePathReadable).toBe(false);
  });

  it("refuses a basePath that is a template literal or an expression", () => {
    const root = makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
      "next.config.js": "module.exports = { basePath: `/${process.env.PREFIX}` }\n",
    });
    expect(codes(buildReport(root))).toContain("config-past-what-i-read");
  });
});

describe("a route slot is checked across the scan set and classified by marker", () => {
  const base = {
    "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
    "app/page.tsx": page,
  };

  it("refuses a slot holding a file that is not ours, at any enabled extension", () => {
    const root = makeTree({ ...base, "app/api/flows/route.js": "export function GET() {}\n" });
    const report = buildReport(root);
    expect(codes(report)).toContain("route-slot-occupied");
    expect(report.refusals.find((r) => r.code === "route-slot-occupied").message).toContain("route.js");
  });

  it("completes when the slot holds only our own marker-matching file — the second run", () => {
    // Under a presence-only rule this fixture refuses, which is why it is a positive case: it is
    // the assertion that fails on the contradiction rather than reporting it.
    const root = makeTree({
      ...base,
      "app/api/flows/route.ts": "// fsd:generated\nexport function GET() {}\n",
      "app/api/flows/[...path]/route.ts": "// fsd:generated\nexport function GET() {}\n",
    });
    const report = buildReport(root);
    expect(codes(report)).not.toContain("route-slot-occupied");
    expect(report.routeSlots.every((s) => s.verdict === "ours")).toBe(true);
  });

  it("refuses when our file shares the slot with an unmarked one", () => {
    const root = makeTree({
      ...base,
      "app/api/flows/route.ts": "// fsd:generated\nexport function GET() {}\n",
      "app/api/flows/route.js": "export function GET() {}\n",
    });
    expect(codes(buildReport(root))).toContain("route-slot-occupied");
  });

  it("refuses our own stale file at an extension pageExtensions no longer enables", () => {
    // Reachable ONLY because the scan set covers ts and tsx regardless of what is enabled. Under
    // an enabled-only scan this fixture reports the slot empty, writes a second file beside the
    // stale one, and passes — this row failing to fire rather than passing.
    const root = makeTree({
      ...base,
      "next.config.js": "module.exports = { pageExtensions: ['tsx'] }\n",
      "app/api/flows/route.ts": "// fsd:generated\nexport function GET() {}\n",
    });
    const report = buildReport(root);
    expect(codes(report)).toContain("route-slot-stale");
    expect(report.routeExtension.value).toBe("tsx");
  });
});

describe("the dev command, and the refusal scoped to the topology that spends it", () => {
  it("renders the script the project actually has, and its port", () => {
    const root = makeTree({
      "package.json": nextManifest({ scripts: { serve: "next dev -p 4000" }, packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
    });
    const report = buildReport(root);
    expect(report.devCommand.script).toBe("serve");
    expect(report.devCommand.port).toBe(4000);
    expect(report.devCommand.url).toBe("http://localhost:4000");
  });

  it("refuses a Next host with no identifiable dev script", () => {
    const root = makeTree({
      "package.json": manifest({ dependencies: { next: "^15.4.0" }, packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
    });
    expect(codes(buildReport(root))).toContain("no-dev-script");
  });

  it("reports a dash-named dev script rather than refusing it", () => {
    // The renderer separates these and the printed command runs, so the project is a coherent
    // host. Detection's job is to tell the renderer the name needs the separator.
    const root = makeTree({
      "package.json": nextManifest({ scripts: { "--help": "next dev" }, packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
    });
    const report = buildReport(root);
    expect(report.refusals).toEqual([]);
    expect(report.devCommand.script).toBe("--help");
    expect(report.devCommand.needsSeparator).toBe(true);
  });

  it("agrees with the renderer about which script names need the separator", () => {
    // Twinned by construction: the two halves agree because this asserts it over one table, not
    // because they were written from the same intention.
    for (const name of ["--help", "-p", "dev", "dev:web", "start-server", "list"]) {
      const detectorSeparates = needsRunSeparator(name);
      const rendererSeparates =
        renderNextSteps({
          topology: "mounted-route",
          packageManager: "pnpm",
          devScript: name,
          devUrl: "http://localhost:3000",
          mountPath: "/api/flows",
        }).includes(`pnpm run -- ${name}`);
      expect(rendererSeparates, `disagreement on ${JSON.stringify(name)}`).toBe(detectorSeparates);
    }
  });

  it("completes on a plain-Node host with no dev script at all", () => {
    // The case that fails on an over-broad refusal: the second-process branch prints only fsdev
    // commands and names neither the project's script nor its port, so a library, a `node
    // server.js` service or a container entrypoint is a coherent host.
    const root = makeTree({ "package.json": manifest({ packageManager: "npm@10.0.0" }) });
    const report = buildReport(root);
    expect(codes(report)).not.toContain("no-dev-script");
    expect(report.refusals).toEqual([]);
    expect(report.devCommand.script).toBe(null);
  });
});
