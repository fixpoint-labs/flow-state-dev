/**
 * Resolution 8 and 8b (the config the CLI loads and what its registry holds), the delimiter
 * accounting for the two prose files, the Node floor, and the two properties that hold over the
 * whole module: the report's shape is a contract, and detection writes nothing.
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildReport, REPORT_SCHEMA, meetsNodeFloor } from "../skills/install-fsd/detect/report.mjs";
import { inspectRegistry, resolveLoadedConfig } from "../skills/install-fsd/detect/fsdev-config.mjs";
import { accountDelimiters } from "../skills/install-fsd/detect/prose-files.mjs";
import { cleanupTrees, initGit, makeTree, manifest, snapshotTree } from "./helpers.mjs";

afterAll(cleanupTrees);

const codes = (report) => report.refusals.map((r) => r.code);
const base = { "package.json": manifest({ packageManager: "npm@10.0.0" }) };
const ourConfig = `// fsd:generated\nimport hello from "./flows/hello/flow.mts";\nexport default createFlowState({ flows: { hello } });\n`;
const ourFlow = `// fsd:generated\nexport default defineFlow({ kind: "hello" })({ id: "default" });\n`;

describe("the config the run acts on is the one the CLI loads", () => {
  it("reports every candidate in the CLI's own precedence order, with the winner named", () => {
    const root = makeTree({
      ...base,
      "fsdev.config.mts": ourConfig,
      "fsdev.config.ts": "export default createFlowState({ flows: {} });\n",
      "fsdev.config.js": "module.exports = {};\n",
    });
    const resolved = resolveLoadedConfig(root);
    expect(resolved.order).toEqual([
      "fsdev.config.ts",
      "fsdev.config.mts",
      "fsdev.config.js",
      "fsdev.config.mjs",
    ]);
    expect(resolved.winner).toBe(join(root, "fsdev.config.ts"));
    expect(resolved.shadowed).toEqual([join(root, "fsdev.config.mts"), join(root, "fsdev.config.js")]);
  });

  it("does not call the demo flow registered on the strength of a shadowed config of ours", () => {
    // Under the single-config model this fixture reports "flow registered" and passes — the check
    // that cannot fail, on a file the loader is not loading.
    const root = makeTree({
      ...base,
      "fsdev.config.mts": ourConfig,
      "fsdev.config.ts": "export default createFlowState({ flows: {} });\n",
      "flows/hello/flow.mts": ourFlow,
    });
    const report = buildReport(root);
    expect(report.fsdevConfig.winner).toBe(join(root, "fsdev.config.ts"));
    expect(report.fsdevConfig.winnerIsOurs).toBe(false);
  });

  it("several configs in one directory is legal, not a refusal", () => {
    const root = makeTree({ ...base, "fsdev.config.ts": "export default {};\n", "fsdev.config.mts": ourConfig });
    expect(codes(buildReport(root))).not.toContain("demo-kind-taken");
  });

  it("recognises a config of ours by its marker, on the winner", () => {
    const root = makeTree({ ...base, "fsdev.config.mts": ourConfig, "flows/hello/flow.mts": ourFlow });
    const report = buildReport(root);
    expect(report.fsdevConfig.winner).toBe(join(root, "fsdev.config.mts"));
    expect(report.fsdevConfig.winnerIsOurs).toBe(true);
  });
});

describe("resolution 8b — what their registry holds", () => {
  it("finds our own entry by the import it resolves to, never by the flow's kind", () => {
    // An idempotency check keyed on the kind reads the name, concludes the entry is ours, skips
    // registration, and writes the flow file anyway.
    const root = makeTree({
      ...base,
      "fsdev.config.ts": `import hello from "./flows/hello/flow.mts";\nimport theirs from "./src/flows/billing.ts";\nexport default createFlowState({ flows: { hello, billing: theirs } });\n`,
      "flows/hello/flow.mts": ourFlow,
      "src/flows/billing.ts": `export default defineFlow({ kind: "billing" })({ id: "default" });\n`,
    });
    const registry = inspectRegistry(join(root, "fsdev.config.ts"));
    expect(registry.extendable).toBe(true);
    expect(registry.ourEntry?.specifier).toBe("./flows/hello/flow.mts");
    expect(registry.demoKind).toBe("free");
  });

  it("refuses when an unrelated flow of the demo's kind is already registered", () => {
    // A kind is a namespace we do not own: registering ours over theirs throws at load, and
    // skipping registration is worse — `fsdev run hello send` then invokes THEIR flow.
    const root = makeTree({
      ...base,
      "fsdev.config.ts": `import greeter from "./src/flows/greeter.ts";\nexport default createFlowState({ flows: { greeter } });\n`,
      "src/flows/greeter.ts": `export default defineFlow({ kind: "hello" })({ id: "default" });\n`,
    });
    const report = buildReport(root);
    expect(codes(report)).toContain("demo-kind-taken");
    expect(report.refusals.find((r) => r.code === "demo-kind-taken").message).toContain("./src/flows/greeter.ts");
    // Nothing was written to find that out.
    expect(report.fsdevConfig.registry.demoKind).toBe("taken");
  });

  it("reads the registry createFlowState is given, not the first flows: in the file", () => {
    // Root B, the same defect one file over from `basePath`. A helper object above the real call
    // won, so a live registry that already owns `hello` reported free — and the run would have
    // registered a second flow of a kind somebody else already had, throwing at load.
    const root = makeTree({
      ...base,
      "fsdev.config.ts": [
        `import greeter from "./src/flows/greeter.ts";`,
        `const example = { flows: {} };`,
        `// const old = { flows: { hello: nothing } };`,
        `export default createFlowState({ flows: { greeter } });`,
        "",
      ].join("\n"),
      "src/flows/greeter.ts": `export default defineFlow({ kind: "hello" })({ id: "default" });\n`,
    });
    const registry = inspectRegistry(join(root, "fsdev.config.ts"));
    expect(registry.extendable).toBe(true);
    expect(registry.entries.map((e) => e.name)).toEqual(["greeter"]);
    expect(registry.demoKind).toBe("taken");
    expect(codes(buildReport(root))).toContain("demo-kind-taken");
  });

  it("reports undetermined when it cannot tell which createFlowState call is the config's", () => {
    const root = makeTree({
      ...base,
      "fsdev.config.ts": [
        `const a = createFlowState({ flows: {} });`,
        `const b = createFlowState({ flows: {} });`,
        `export default process.env.CI ? a : b;`,
        "",
      ].join("\n"),
    });
    const registry = inspectRegistry(join(root, "fsdev.config.ts"));
    expect(registry.extendable).toBe(false);
    expect(registry.demoKind).toBe("undetermined");
    expect(registry.why).toContain("createFlowState");
  });

  it("still resolves an import specifier, which is itself a string", () => {
    // The regression the shared walker introduced and the registry tests caught: blanking string
    // bodies to find assignments also blanked `import x from "./y"` down to `"      "`.
    const root = makeTree({
      ...base,
      "fsdev.config.ts": `import hello from "./flows/hello/flow.mts";\nexport default createFlowState({ flows: { hello } });\n`,
      "flows/hello/flow.mts": ourFlow,
    });
    expect(inspectRegistry(join(root, "fsdev.config.ts")).ourEntry?.specifier).toBe(
      "./flows/hello/flow.mts",
    );
  });

  it("reports a registry it cannot read statically as not extendable, rather than as free", () => {
    // This is the one state where the demo flow really may be unregistered, and reporting it as
    // free would write files that never load.
    const root = makeTree({
      ...base,
      "fsdev.config.ts": `import { all } from "./registry.ts";\nexport default createFlowState({ flows: { ...all } });\n`,
      "registry.ts": "export const all = {};\n",
    });
    const registry = inspectRegistry(join(root, "fsdev.config.ts"));
    expect(registry.extendable).toBe(false);
    expect(registry.demoKind).toBe("undetermined");
  });

  it("does not claim a foreign module at our stem as ours", () => {
    // `./flows/hello/flow.js` normalises to the same stem as the file we write (`flow.mts`).
    // Ownership is the resolved path plus the generated marker — the specifier alone is a
    // proxy, and acting on `demoKind: "free"` leaves their flow registered instead of the demo.
    const root = makeTree({
      ...base,
      "fsdev.config.ts": `import hello from "./flows/hello/flow.js";\nexport default createFlowState({ flows: { hello } });\n`,
      "flows/hello/flow.js": `export default defineFlow({ kind: "hello" })({ id: "default" });\n`,
    });
    const registry = inspectRegistry(join(root, "fsdev.config.ts"));
    expect(registry.ourEntry).toBeNull();
    expect(registry.demoKind).toBe("taken");
    expect(codes(buildReport(root))).toContain("demo-kind-taken");
  });

  it("does not refuse over a kind it could not read", () => {
    // Undetermined is not `taken`: refusing here would lock out a project whose flow module we
    // simply cannot parse, and the skill has a documented fallback for it.
    const root = makeTree({
      ...base,
      "fsdev.config.ts": `import x from "./nowhere.ts";\nexport default createFlowState({ flows: { x } });\n`,
    });
    expect(codes(buildReport(root))).not.toContain("demo-kind-taken");
    expect(buildReport(root).fsdevConfig.registry.demoKind).toBe("undetermined");
  });
});

describe("the write barrier checks the path it would write, not a proxy for it", () => {
  it("refuses when the demo flow's own path holds a file we did not write", () => {
    // The registry can say our demo kind is free while the FILE we would write already exists —
    // a project can own `flows/hello/flow.mts` without registering it. Checking the registry for
    // this is checking a statement about the config instead of the thing on disk.
    const root = makeTree({
      ...base,
      "flows/hello/flow.mts": "// somebody else's file\nexport default whatever;\n",
    });
    const report = buildReport(root);
    expect(codes(report)).toContain("demo-flow-path-occupied");
    expect(report.fsdevConfig.registry.demoKind).toBe("free");
  });

  it("does not refuse when that path holds a file we wrote — the ordinary rerun", () => {
    const root = makeTree({ ...base, "flows/hello/flow.mts": ourFlow });
    expect(codes(buildReport(root))).not.toContain("demo-flow-path-occupied");
  });
});

describe("a malformed delimiter block refuses and deletes nothing", () => {
  const rules = Array.from({ length: 20 }, (_, i) => `rule-${i}`).join("\n");

  it("refuses a start delimiter with no end, and the developer's rules survive", () => {
    // The implementation this catches finds the start, searches for the end, and truncates to
    // EOF; it passes a check that only asserts the run stopped.
    const root = makeTree({ ...base, ".gitignore": `# flow-state-dev:start\n.env.local\n${rules}\n` });
    const before = snapshotTree(root);
    const report = buildReport(root);
    expect(codes(report)).toContain("delimiters-malformed");
    expect(snapshotTree(root)).toEqual(before);
  });

  it("refuses two complete sections, naming every delimiter line", () => {
    const root = makeTree({
      ...base,
      "AGENTS.md": `# Project\n<!-- flow-state-dev:start -->\na\n<!-- flow-state-dev:end -->\nmid\n<!-- flow-state-dev:start -->\nb\n<!-- flow-state-dev:end -->\n`,
    });
    const report = buildReport(root);
    expect(codes(report)).toContain("delimiters-malformed");
    expect(report.instructionsFile.delimiters).toHaveLength(4);
    const message = report.refusals.find((r) => r.code === "delimiters-malformed").message;
    expect(message).toContain("line 2");
    expect(message).toContain("line 8");
  });

  it("refuses an end delimiter before its start", () => {
    const root = makeTree({ ...base, ".gitignore": "# flow-state-dev:end\nx\n# flow-state-dev:start\n" });
    expect(codes(buildReport(root))).toContain("delimiters-malformed");
  });

  it("accepts exactly one balanced pair — the negative control", () => {
    const root = makeTree({
      ...base,
      ".gitignore": `${rules}\n# flow-state-dev:start\n.env.local\n# flow-state-dev:end\nmore-rules\n`,
    });
    const report = buildReport(root);
    expect(codes(report)).not.toContain("delimiters-malformed");
    expect(report.ignoreFile.verdict).toBe("balanced");
  });

  it("reports an untouched file as absent rather than malformed", () => {
    const root = makeTree({ ...base, ".gitignore": "node_modules\n" });
    expect(accountDelimiters(join(root, ".gitignore")).verdict).toBe("absent");
  });
});

describe("the Node floor is 22.18, compared numerically", () => {
  it.each([
    ["v22.18.0", true],
    ["v22.22.2", true],
    ["v23.0.0", true],
    ["v22.17.1", false],
    ["v22.9.0", false],
    ["v20.19.0", false],
  ])("%s meets the floor: %s", (version, expected) => {
    // 22.9 is the case a string comparison gets wrong, and `>=22` is the case the floor exists
    // for: it passes 22.0–22.17, which then fail every printed command at config load.
    expect(meetsNodeFloor(version)).toBe(expected);
  });

  it("refuses before writing when the running Node is below the floor", () => {
    const root = makeTree(base);
    const report = buildReport(root, { nodeVersion: "v22.17.1" });
    expect(codes(report)).toContain("node-below-floor");
    expect(report.refusals.find((r) => r.code === "node-below-floor").message).toContain("22.18.0");
  });
});

describe("the report's shape is the skill's contract", () => {
  it("carries every field the skill acts on, under a versioned schema", () => {
    // The skill is the consumer and there is no compiler between them, so the shape is asserted
    // directly rather than left to whatever a caller happens to read.
    const root = makeTree({ ...base, ".gitignore": ".env.local\n" });
    initGit(root);
    const report = buildReport(root);
    expect(report.schema).toBe(REPORT_SCHEMA);
    for (const key of [
      "target",
      "runtime",
      "roots",
      "host",
      "appRoot",
      "packageManager",
      "routeExtension",
      "mount",
      "routeSlots",
      "devCommand",
      "moduleSystem",
      "fsdevConfig",
      "secrets",
      "providerKeys",
      "secretFiles",
      "ignoreFile",
      "instructionsFile",
      "declaredFsdDependencies",
      "refusals",
    ]) {
      expect(report, `the report must carry ${key}`).toHaveProperty(key);
    }
    expect(report.roots).toMatchObject({ writeRoot: root, workspaceRoot: expect.any(String) });
    expect(report.runtime).toMatchObject({ floor: "22.18.0", meetsFloor: expect.any(Boolean) });
    // Every refusal names a code, what the developer is told, and what fixes it.
    for (const refusal of report.refusals) {
      expect(refusal).toMatchObject({
        code: expect.any(String),
        message: expect.any(String),
        remediation: expect.any(String),
      });
    }
  });

  it("reports the module system, which the developer's own later files depend on", () => {
    const root = makeTree({ "package.json": manifest({ type: "commonjs", packageManager: "npm@10.0.0" }) });
    expect(buildReport(root).moduleSystem).toBe("commonjs");
  });

  it("reports which of our dependencies are already declared, at what versions", () => {
    const root = makeTree({
      "package.json": manifest({
        packageManager: "npm@10.0.0",
        dependencies: { "@flow-state-dev/core": "^0.1.0", zod: "^4.0.0" },
      }),
    });
    expect(buildReport(root).declaredFsdDependencies).toEqual({ "@flow-state-dev/core": "^0.1.0" });
  });
});

describe("detection writes nothing", () => {
  it("leaves a seeded tree byte-identical, mtimes included", () => {
    const root = makeTree({
      ...base,
      ".gitignore": ".env.local\n",
      ".env.local": "OPENAI_API_KEY=\n",
      "AGENTS.md": "# Project\n",
      "fsdev.config.ts": "export default createFlowState({ flows: {} });\n",
      "app/page.tsx": "export default function Page() { return null }\n",
    });
    initGit(root);
    const before = snapshotTree(root);
    buildReport(root, { providerKey: "OPENAI_API_KEY" });
    expect(snapshotTree(root)).toEqual(before);
  });

  it("leaves the tree unchanged on a run that refuses, too", () => {
    // The invariant that matters: nothing is written until every refusal has been evaluated, so a
    // refusing run cannot leave a mutation behind.
    const root = makeTree({
      "package.json": manifest(),
      "pnpm-lock.yaml": "",
      "package-lock.json": "{}\n",
      ".gitignore": "# flow-state-dev:start\nkeep-me\n",
    });
    const before = snapshotTree(root);
    const report = buildReport(root);
    expect(report.refusals.length).toBeGreaterThan(0);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("writes nothing when run through the script's own entry point either", () => {
    const root = makeTree({ ...base, ".gitignore": ".env.local\n" });
    initGit(root);
    const before = snapshotTree(root);
    execFileSync(
      process.execPath,
      [join(import.meta.dirname, "../skills/install-fsd/detect/detect.mjs"), root, "--prose"],
      { encoding: "utf-8" },
    );
    expect(snapshotTree(root)).toEqual(before);
  });
});

describe("the writes-nothing check ignores git's own bookkeeping", () => {
  // Why the snapshot skips `.git/` is on `snapshotTree` in helpers.mjs; these pin the two ways the
  // race showed up before it did.

  it("does not flag a file git created under .git/ between the two snapshots", () => {
    const root = makeTree({ ...base, ".gitignore": ".env.local\n" });
    initGit(root);
    const before = snapshotTree(root);
    writeFileSync(join(root, ".git/objects/fsd-test-created.lock"), "");
    buildReport(root);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("does not walk .git/, so an entry that vanishes there between listing and stat cannot throw", () => {
    // A dangling symlink is listed by readdirSync and fails statSync with ENOENT — the same shape
    // as git deleting its lock between the two calls, without having to win a race to show it.
    // Planted under a name git never creates, so the setup can't collide with git's own lock.
    const root = makeTree({ ...base, ".gitignore": ".env.local\n" });
    initGit(root);
    symlinkSync(join(root, ".git/objects/gone.lock"), join(root, ".git/objects/fsd-test-vanished.lock"));
    expect(() => snapshotTree(root)).not.toThrow();
  });
});

describe("the entry point", () => {
  const run = (args) => {
    try {
      const stdout = execFileSync(
        process.execPath,
        [join(import.meta.dirname, "../skills/install-fsd/detect/detect.mjs"), ...args],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
      return { code: 0, stdout };
    } catch (err) {
      return { code: err.status, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
    }
  };

  it("exits 0 and prints JSON when nothing refuses", () => {
    const root = makeTree({ ...base, ".gitignore": ".env.local\n" });
    initGit(root);
    const result = run([root, "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).refusals).toEqual([]);
  });

  it("exits 1 with the report still on stdout when a refusal fires", () => {
    // A refusal is not a crash: the report is still the deliverable, because the developer needs
    // to be told which condition failed and what would fix it.
    const root = makeTree({ "package.json": manifest() });
    const result = run([root, "--json"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).refusals.map((r) => r.code)).toContain("package-manager-undeclared");
  });

  it("exits 2 on a bad argument", () => {
    expect(run(["--nonsense"]).code).toBe(2);
    expect(run(["--provider", "NOT_A_KEY"]).code).toBe(2);
  });

  it("renders prose when asked, carrying the same facts as the JSON", () => {
    const root = makeTree({ ...base, ".gitignore": ".env.local\n" });
    initGit(root);
    const prose = run([root, "--prose"]).stdout;
    expect(prose).toContain("running FSD detection");
    expect(prose).toContain("host:");
    expect(prose).toContain("npm");
  });
});
