/**
 * Tests for the canonical next-steps block.
 *
 * Four things are being pinned, and they fail in different ways:
 *  1. rendering — the right branch, the right commands, and a refusal rather than a printed
 *     `{{devScript}}`;
 *  2. content invariance — the same steps, order and caveats across every package manager;
 *  3. the caveat constraint — canonical may not promise anything about production, because the
 *     equality check below would then actively defend the false claim in every shipper's copy;
 *  4. the commands actually run — the strings are executed through the real package managers,
 *     never matched against a pattern. A plausible-looking transcript has hidden a broken
 *     command before; `npm exec` and `yarn exec` both eat `--host 127.0.0.1` without a `--`.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CANONICAL_NEXT_STEPS,
  PACKAGE_MANAGER_COMMAND_FORMS,
  assertCanonicalNextSteps,
  compareToCanonicalNextSteps,
  renderNextSteps,
  type NextStepsPackageManager,
  type NextStepsTopology,
} from "../src/next-steps";

const MANAGERS: NextStepsPackageManager[] = ["npm", "pnpm", "yarn"];

const MOUNTED = {
  topology: "mounted-route" as const,
  devScript: "serve",
  devUrl: "http://localhost:4000",
  mountPath: "/portal/api/flows",
};

// ---------------------------------------------------------------------------
// 1. Rendering
// ---------------------------------------------------------------------------

describe("renderNextSteps", () => {
  it("renders only the branch for the topology it was asked for", () => {
    const mounted = renderNextSteps({ ...MOUNTED, packageManager: "pnpm" });
    const second = renderNextSteps({ topology: "second-process", packageManager: "pnpm" });

    expect(mounted).toContain("your app, now serving FSD at /portal/api/flows");
    expect(mounted).not.toContain("beside your own server");

    expect(second).toContain("beside your own server");
    expect(second).not.toContain("your app, now serving FSD at");
  });

  it("keeps both branches in the source even though each render drops one", () => {
    // The check every shipper's copy is measured against reads the whole block. A shipper that
    // trims the branch it cannot reach breaks it, so canonical must carry both.
    expect(CANONICAL_NEXT_STEPS).toContain("{{#mounted-route}}");
    expect(CANONICAL_NEXT_STEPS).toContain("{{/mounted-route}}");
    expect(CANONICAL_NEXT_STEPS).toContain("{{#second-process}}");
    expect(CANONICAL_NEXT_STEPS).toContain("{{/second-process}}");
  });

  it("leaves no placeholder or delimiter in a rendered block", () => {
    for (const packageManager of MANAGERS) {
      expect(renderNextSteps({ ...MOUNTED, packageManager })).not.toMatch(/\{\{|\}\}/);
      expect(renderNextSteps({ topology: "second-process", packageManager })).not.toMatch(/\{\{|\}\}/);
    }
  });

  it("renders a second-process host without a dev script, a dev URL or a mount path", () => {
    // A plain-Node project with no dev script is a coherent host, not a broken one: this branch
    // prints only `fsdev` commands and names neither the project's script nor its port.
    const second = renderNextSteps({ topology: "second-process", packageManager: "npm" });
    expect(second).not.toContain("undefined");
    expect(second).not.toContain("api/flows");
  });

  it("refuses to print a placeholder when a mounted-route value is missing", () => {
    expect(() =>
      renderNextSteps({ topology: "mounted-route", packageManager: "pnpm", devScript: "dev" }),
    ).toThrow(/devUrl, mountPath/);
  });

  it("refuses a package manager it has no command forms for", () => {
    expect(() =>
      renderNextSteps({
        ...MOUNTED,
        packageManager: "bun" as NextStepsPackageManager,
      }),
    ).toThrow(/Unsupported package manager "bun"/);
  });

  it("never prints the bare mount path when a basePath was resolved", () => {
    const mounted = renderNextSteps({ ...MOUNTED, packageManager: "pnpm" });
    // Next's router tests the basePath prefix and returns before route matching, so the bare
    // path is not merely unmatched — it is rejected upstream of the matcher.
    expect(mounted).toContain("/portal/api/flows");
    expect(mounted).not.toMatch(/(^|[^/\w])\/api\/flows/);
  });

  it("never offers the DevTool as a way to exercise the demo flow", () => {
    // The DevTool sends one app-global bearer on every request. A project whose config points
    // `devtool.bearerToken` at something else would get a 401 on the first click, so the block
    // describes what `fsdev dev` is and never claims it reaches the demo.
    for (const topology of ["mounted-route", "second-process"] as NextStepsTopology[]) {
      const rendered = renderNextSteps({ ...MOUNTED, topology, packageManager: "pnpm" });
      const devToolLines = rendered.split("\n").filter((line) => line.includes("DevTool"));
      expect(devToolLines.length).toBeGreaterThan(0);
      for (const line of devToolLines) {
        expect(line).not.toMatch(/demo|hello|try it|exercise/i);
      }
    }
  });

  it("never prints --allow-unauthenticated", () => {
    for (const topology of ["mounted-route", "second-process"] as NextStepsTopology[]) {
      expect(renderNextSteps({ ...MOUNTED, topology, packageManager: "npm" })).not.toContain(
        "--allow-unauthenticated",
      );
    }
  });

  it("keeps the loopback flag on the second-process serve command", () => {
    // With a per-flow resolver installed every served flow authenticates, so the CLI's bind
    // guard returns early and a bare `fsdev serve` now succeeds. Nothing but this assertion
    // keeps the flag.
    for (const packageManager of MANAGERS) {
      const second = renderNextSteps({ topology: "second-process", packageManager });
      expect(second).toContain("fsdev serve --host 127.0.0.1");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Content invariance across managers
// ---------------------------------------------------------------------------

describe("the block says the same thing under every package manager", () => {
  /** Put the manager's command forms back where they came from, longest form first. */
  function reabstract(rendered: string, manager: NextStepsPackageManager): string {
    const { run, exec, execSep } = PACKAGE_MANAGER_COMMAND_FORMS[manager];
    return rendered
      .split(`${exec}${execSep} `)
      .join("{{exec}}{{execSep}} ")
      .split(`${run} `)
      .join("{{run}} ");
  }

  it("differs only where the commands differ", () => {
    for (const topology of ["mounted-route", "second-process"] as NextStepsTopology[]) {
      const abstracted = MANAGERS.map((manager) =>
        reabstract(renderNextSteps({ ...MOUNTED, topology, packageManager: manager }), manager),
      );
      // Asserted on the content, not on the rendered string: requiring the renderings
      // themselves to match byte-for-byte is wrong for at least one supported manager.
      expect(abstracted[1]).toBe(abstracted[0]);
      expect(abstracted[2]).toBe(abstracted[0]);
    }
  });

  it("renders genuinely different commands, so the check above is not vacuous", () => {
    const npm = renderNextSteps({ ...MOUNTED, packageManager: "npm" });
    const pnpm = renderNextSteps({ ...MOUNTED, packageManager: "pnpm" });
    expect(npm).not.toBe(pnpm);
    expect(npm).toContain("npm run serve");
    expect(npm).toContain("npm exec -- fsdev dev");
    expect(pnpm).toContain("pnpm serve");
    expect(pnpm).toContain("pnpm exec fsdev dev");
  });
});

// ---------------------------------------------------------------------------
// 3. The caveat constraint
// ---------------------------------------------------------------------------

describe("the caveats describe today's behaviour and promise nothing about production", () => {
  it("makes no production claim and keys nothing to an environment", () => {
    // All three claims are false of the code: the bind guard runs only under `fsdev serve`,
    // never in `packages/next`; it keys on the bind address, not on NODE_ENV; its enforcement
    // is whole-app; and it never sees a mounted route. A false claim cannot be corrected
    // downstream, because the equality check would read the correction as drift — so the word
    // stays out of canonical entirely and the docs page carries the deployment guidance.
    expect(CANONICAL_NEXT_STEPS).not.toMatch(/production/i);
    expect(CANONICAL_NEXT_STEPS).not.toContain("NODE_ENV");
    expect(CANONICAL_NEXT_STEPS).not.toMatch(/refuses? to serve/i);
    expect(CANONICAL_NEXT_STEPS).not.toMatch(/once (you configure|authentication)/i);
  });

  it("states what the demo flow does today, on both branches", () => {
    for (const topology of ["mounted-route", "second-process"] as NextStepsTopology[]) {
      const rendered = renderNextSteps({ ...MOUNTED, topology, packageManager: "pnpm" });
      expect(rendered).toContain("Authorization: Bearer $FSD_DEMO_TOKEN");
      expect(rendered).toContain("no model call is made");
      // The developer's own routes keep serving — the property an import-time throw destroys.
      expect(rendered).toContain("everything else this project serves is unchanged");
      // `fsdev run` never authenticates; documenting it is what stops someone "fixing" it.
      expect(rendered).toMatch(/fsdev run never authenticates/);
      // Not deployable as it stands, said in its own output.
      expect(rendered).toContain("A shared secret is not authentication");
      expect(rendered).toContain("development file store");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The comparison
// ---------------------------------------------------------------------------

describe("compareToCanonicalNextSteps", () => {
  it("accepts a verbatim copy", () => {
    expect(compareToCanonicalNextSteps(CANONICAL_NEXT_STEPS).matches).toBe(true);
  });

  it("accepts a copy that only differs in line endings, trailing space and uniform indent", () => {
    const embedded = CANONICAL_NEXT_STEPS.split("\n")
      .map((line) => (line === "" ? line : `    ${line}   `))
      .join("\r\n");
    expect(compareToCanonicalNextSteps(`\n\n${embedded}\n\n`).matches).toBe(true);
  });

  it("rejects a copy with the branch that shipper never renders trimmed out", () => {
    // The regression this exists for. A presence check passes here; equality over the whole
    // block is what fails.
    const trimmed = CANONICAL_NEXT_STEPS.replace(
      /\{\{#second-process\}\}\n[\s\S]*?\{\{\/second-process\}\}\n/,
      "",
    );
    expect(trimmed).not.toBe(CANONICAL_NEXT_STEPS);
    const result = compareToCanonicalNextSteps(trimmed);
    expect(result.matches).toBe(false);
    expect(result.reason).toMatch(/line \d+ differs/);
  });

  it("rejects a caveat someone softened in their own copy", () => {
    const softened = CANONICAL_NEXT_STEPS.replace(
      "A shared secret is not authentication",
      "A shared secret is fine for now",
    );
    expect(compareToCanonicalNextSteps(softened).matches).toBe(false);
  });

  it("rejects a rendered block — the comparison is over the source, placeholders included", () => {
    expect(
      compareToCanonicalNextSteps(renderNextSteps({ ...MOUNTED, packageManager: "pnpm" })).matches,
    ).toBe(false);
  });

  it("names the copy in the assertion form's failure", () => {
    expect(() => assertCanonicalNextSteps("Next steps\n", "SKILL.md")).toThrow(/^SKILL\.md has drifted/);
    expect(() => assertCanonicalNextSteps(CANONICAL_NEXT_STEPS)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. The printed commands actually run
// ---------------------------------------------------------------------------

/**
 * A project directory holding a `fsdev`-named bin that prints the argv it received, so a
 * printed command can be executed and its arguments inspected. This is the check that catches
 * an option separator: `npm exec fsdev serve --host 127.0.0.1` reaches the binary as
 * `["serve","127.0.0.1"]`, and so does the yarn form without a separator.
 */
const projectRoots = new Map<NextStepsPackageManager, string>();

function projectFor(manager: NextStepsPackageManager): string {
  const existing = projectRoots.get(manager);
  if (existing !== undefined) return existing;

  const root = mkdtempSync(join(tmpdir(), `fsdev-next-steps-${manager}-`));
  // No ancestor `packageManager` field in a tmpdir, so corepack stays out of the way.
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "next-steps-probe",
        version: "1.0.0",
        private: true,
        scripts: { serve: "node ./echo-argv.js --from-script" },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "echo-argv.js"),
    `#!/usr/bin/env node\nconsole.log("ARGV=" + JSON.stringify(process.argv.slice(2)));\n`,
  );
  chmodSync(join(root, "echo-argv.js"), 0o755);

  const pkgDir = join(root, "node_modules", "fsdev-probe");
  mkdirSync(join(pkgDir, "bin"), { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    `${JSON.stringify({ name: "fsdev-probe", version: "1.0.0", bin: { fsdev: "./bin/fsdev.js" } })}\n`,
  );
  writeFileSync(
    join(pkgDir, "bin", "fsdev.js"),
    `#!/usr/bin/env node\nconsole.log("ARGV=" + JSON.stringify(process.argv.slice(2)));\n`,
  );
  chmodSync(join(pkgDir, "bin", "fsdev.js"), 0o755);

  const binDir = join(root, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  symlinkSync(resolve(pkgDir, "bin", "fsdev.js"), join(binDir, "fsdev"));

  projectRoots.set(manager, root);
  return root;
}

afterAll(() => {
  for (const root of projectRoots.values()) rmSync(root, { recursive: true, force: true });
});

/** Is this manager on the machine running the tests? */
function managerAvailable(manager: NextStepsPackageManager): boolean {
  try {
    execFileSync(manager, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Run one printed command line in the probe project and return the argv the binary saw. */
function runPrintedCommand(manager: NextStepsPackageManager, line: string): string[] {
  const output = execFileSync("/bin/sh", ["-c", line], {
    cwd: projectFor(manager),
    encoding: "utf-8",
    env: { ...process.env, npm_config_yes: "true" },
  });
  const match = /ARGV=(\[.*\])/.exec(output);
  if (match === null) {
    throw new Error(`Command \`${line}\` produced no argv line. Output:\n${output}`);
  }
  return JSON.parse(match[1]!) as string[];
}

/** Every command line in a rendered block: the indented lines that start with a manager token. */
function printedCommandLines(rendered: string, manager: NextStepsPackageManager): string[] {
  const { run, exec } = PACKAGE_MANAGER_COMMAND_FORMS[manager];
  return rendered
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${exec} `) || line.startsWith(`${run} `));
}

describe("the printed commands actually run", () => {
  const available = MANAGERS.filter(managerAvailable);

  it("has npm and pnpm to test against", () => {
    // npm ships with Node and pnpm is this repo's own manager, so neither may silently vanish
    // and leave this whole section reporting green on nothing. Yarn is checked when present.
    expect(available).toContain("npm");
    expect(available).toContain("pnpm");
  });

  for (const manager of MANAGERS) {
    describe(manager, () => {
      it.runIf(managerAvailable(manager))(
        "delivers every argument of every printed exec command to the binary",
        () => {
          const { exec, execSep } = PACKAGE_MANAGER_COMMAND_FORMS[manager];
          const rendered = renderNextSteps({ topology: "second-process", packageManager: manager });
          const lines = printedCommandLines(rendered, manager);
          expect(lines.length).toBeGreaterThan(0);

          for (const line of lines) {
            const argv = runPrintedCommand(manager, line);
            // Reconstruct what the line asked the binary to do, and require exactly that.
            const expected = line
              .slice(`${exec}${execSep} `.length)
              .replace(/^fsdev /, "")
              .match(/'[^']*'|\S+/g)!
              .map((token) => (token.startsWith("'") ? token.slice(1, -1) : token));
            expect(argv, `\`${line}\` lost arguments on the way to the binary`).toEqual(expected);
          }
        },
        60_000,
      );

      it.runIf(managerAvailable(manager))(
        "runs the project's own dev script through the printed run form",
        () => {
          const rendered = renderNextSteps({
            ...MOUNTED,
            packageManager: manager,
            devScript: "serve",
          });
          const { run } = PACKAGE_MANAGER_COMMAND_FORMS[manager];
          const line = printedCommandLines(rendered, manager).find((l) => l === `${run} serve`);
          expect(line, "the block did not print the project's own dev script").toBeDefined();
          expect(runPrintedCommand(manager, line!)).toEqual(["--from-script"]);
        },
        60_000,
      );
    });
  }

  it("would go red without the option separator, for the managers that need one", () => {
    // The demonstration that the check above can fail. Emitting the loopback flag without the
    // separator is what a reader of "the separator npm needs and the others do not" writes for
    // yarn, and under it the flag never reaches the binary.
    for (const manager of available) {
      const { exec, execSep } = PACKAGE_MANAGER_COMMAND_FORMS[manager];
      const argv = runPrintedCommand(manager, `${exec} fsdev serve --host 127.0.0.1`);
      if (execSep === "") {
        expect(argv, `${manager} needs no separator`).toEqual(["serve", "--host", "127.0.0.1"]);
      } else {
        expect(argv, `${manager} was expected to eat the flag without its separator`).not.toEqual([
          "serve",
          "--host",
          "127.0.0.1",
        ]);
      }
    }
  }, 60_000);
});
