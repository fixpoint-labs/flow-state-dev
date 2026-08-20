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
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CANONICAL_NEXT_STEPS,
  PACKAGE_MANAGER_COMMAND_FORMS,
  assertCanonicalNextSteps,
  assertEveryPortIsNamed,
  renderNextSteps,
  type NextStepsPackageManager,
  type NextStepsTopology,
} from "../src/next-steps";

/** The comparison has one surface — it throws. `matches` here is only for readability below. */
function matchesCanonical(embedded: string): boolean {
  try {
    assertCanonicalNextSteps(embedded);
    return true;
  } catch {
    return false;
  }
}

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

  it("quotes a dev script name the shell would otherwise take apart", () => {
    // `devScript` is read out of somebody else's package.json and lands in a command position.
    // Unquoted, a name with a space addresses the wrong script and a name with a metacharacter is
    // interpreted by the shell the developer pastes the line into.
    expect(renderNextSteps({ ...MOUNTED, packageManager: "pnpm", devScript: "my script" })).toContain(
      "pnpm run 'my script'",
    );
    expect(
      renderNextSteps({ ...MOUNTED, packageManager: "pnpm", devScript: "dev; echo pwned" }),
    ).toContain("pnpm run 'dev; echo pwned'");
    expect(
      renderNextSteps({ ...MOUNTED, packageManager: "npm", devScript: "build && curl evil.example" }),
    ).toContain("npm run 'build && curl evil.example'");
    // A literal quote survives single-quoting the only way POSIX allows.
    expect(renderNextSteps({ ...MOUNTED, packageManager: "pnpm", devScript: "it's" })).toContain(
      `pnpm run 'it'\\''s'`,
    );
  });

  it("leaves an ordinary script name unquoted", () => {
    // The common case has to stay readable, or the quoting becomes noise a developer edits out.
    expect(renderNextSteps({ ...MOUNTED, packageManager: "pnpm", devScript: "dev" })).toContain(
      "pnpm run dev\n",
    );
    expect(renderNextSteps({ ...MOUNTED, packageManager: "pnpm", devScript: "dev:web" })).toContain(
      "pnpm run dev:web\n",
    );
    expect(renderNextSteps({ ...MOUNTED, packageManager: "npm", devScript: "start-server" })).toContain(
      "npm run start-server\n",
    );
  });

  it("uses the explicit run form for every manager, never the shortcut", () => {
    // `pnpm <name>` and `yarn <name>` lose to the manager's own builtins, and the name here is
    // whatever the project happened to call its script.
    for (const manager of MANAGERS) {
      expect(PACKAGE_MANAGER_COMMAND_FORMS[manager].run).toBe(`${manager} run`);
    }
  });

  it("names a port on every fsdev command that starts a listener", () => {
    // The invariant, not the instance. `fsdev serve` defaults to $PORT then 3000 (a brownfield
    // Next host almost always holds 3000) and `fsdev dev` defaults to 4200 (an Angular host holds
    // that). Pinning them one at a time does not converge, so every binding command names a port
    // from one range the block owns.
    for (const topology of ["mounted-route", "second-process"] as NextStepsTopology[]) {
      const rendered = renderNextSteps({ ...MOUNTED, topology, packageManager: "pnpm" });
      for (const line of rendered.split("\n")) {
        const subcommand = /(?:^|\s)fsdev\s+(\w[\w-]*)/.exec(line)?.[1];
        if (subcommand === undefined) continue;
        if (["run", "block", "chat", "benchmark"].includes(subcommand)) continue;
        const port = /--port[= ](\d+)/.exec(line)?.[1];
        expect(port, `\`${line.trim()}\` binds a port without naming one`).toBeDefined();
        expect(Number(port)).toBeGreaterThanOrEqual(4210);
        expect(Number(port)).toBeLessThanOrEqual(4219);
      }
      // And no URL in the block points at a default either.
      expect(rendered).not.toMatch(/:3000\b/);
      expect(rendered).not.toMatch(/:4200\b/);
    }
  });

  it("refuses a block that adds a bare bind, or one outside the reserved range", () => {
    // The invariant's own test. It runs from `assertCanonicalNextSteps` — the call every shipper
    // already makes — so a future edit fails their suites too rather than reaching a developer as
    // an EADDRINUSE on the one command they were told to type.
    expect(() => assertEveryPortIsNamed(CANONICAL_NEXT_STEPS)).not.toThrow();

    const bare = CANONICAL_NEXT_STEPS.replace("fsdev dev --port 4210", "fsdev dev");
    expect(bare).not.toBe(CANONICAL_NEXT_STEPS);
    expect(() => assertEveryPortIsNamed(bare)).toThrow(/prints `fsdev dev` with no --port/);

    const strayPort = CANONICAL_NEXT_STEPS.replace("--port 4210", "--port 8080");
    expect(() => assertEveryPortIsNamed(strayPort)).toThrow(/outside the range this block owns/);

    // A command added later is covered without anyone remembering to cover it: the subcommand
    // allowlist is default-deny.
    expect(() => assertEveryPortIsNamed("  pnpm exec fsdev preview")).toThrow(
      /prints `fsdev preview` with no --port/,
    );
    // …and a command that starts no listener is not asked to name one.
    expect(() =>
      assertEveryPortIsNamed(`  pnpm exec fsdev run hello send --input '{"userId":"u1"}'`),
    ).not.toThrow();
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
    expect(pnpm).toContain("pnpm run serve");
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

describe("assertCanonicalNextSteps", () => {
  it("accepts a verbatim copy", () => {
    expect(() => assertCanonicalNextSteps(CANONICAL_NEXT_STEPS)).not.toThrow();
  });

  it("accepts a copy that only differs in line endings, trailing space and uniform indent", () => {
    const embedded = CANONICAL_NEXT_STEPS.split("\n")
      .map((line) => (line === "" ? line : `    ${line}   `))
      .join("\r\n");
    expect(matchesCanonical(`\n\n${embedded}\n\n`)).toBe(true);
  });

  it("rejects a copy with the branch that shipper never renders trimmed out", () => {
    // The regression this exists for. A presence check passes here; equality over the whole
    // block is what fails.
    const trimmed = CANONICAL_NEXT_STEPS.replace(
      /\{\{#second-process\}\}\n[\s\S]*?\{\{\/second-process\}\}\n/,
      "",
    );
    expect(trimmed).not.toBe(CANONICAL_NEXT_STEPS);
    expect(() => assertCanonicalNextSteps(trimmed)).toThrow(/line \d+ differs/);
  });

  it("rejects a caveat someone softened in their own copy", () => {
    const softened = CANONICAL_NEXT_STEPS.replace(
      "A shared secret is not authentication",
      "A shared secret is fine for now",
    );
    expect(matchesCanonical(softened)).toBe(false);
  });

  it("rejects a rendered block — the comparison is over the source, placeholders included", () => {
    expect(matchesCanonical(renderNextSteps({ ...MOUNTED, packageManager: "pnpm" }))).toBe(false);
  });

  it("names the copy in the failure message", () => {
    expect(() => assertCanonicalNextSteps("Next steps\n", "SKILL.md")).toThrow(/^SKILL\.md has drifted/);
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
        scripts: {
          serve: "node ./echo-argv.js --from-script",
          // Two script names a shell would take apart if the block printed them bare.
          "my script": "node ./echo-argv.js --from-space-script",
          "dev; echo pwned": "node ./echo-argv.js --from-metachar-script",
          // Two names that collide with a package manager's own builtins. Under the shortcut
          // form (`pnpm list`, `yarn config`) the manager runs itself and the script never does.
          list: "node ./echo-argv.js --from-list-script",
          config: "node ./echo-argv.js --from-config-script",
        },
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

/**
 * Can the probe project above actually be driven by this manager here?
 *
 * Not "is the manager installed". The fixture is a hand-built `node_modules/.bin` with no
 * lockfile, which Yarn Berry rejects before it ever reaches our binary — so an installed-only
 * gate would let Berry in and produce a red that is about the fixture, not about the block.
 * Yarn is therefore gated on major 1, the line this fixture is valid for. npm and pnpm run a
 * lockfile-free directory fine.
 */
function managerAvailable(manager: NextStepsPackageManager): boolean {
  let version: string;
  try {
    version = execFileSync(manager, ["--version"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return false;
  }
  if (manager === "yarn") return version.startsWith("1.");
  return version.length > 0;
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

/** What the stand-in for the developer's own server answers with, so the probe can tell them apart. */
const HOST_MARKER = "the-developers-own-server";

/** One GET, returning the body or `null` when nothing answered. */
async function fetchBody(port: number, path: string): Promise<string | null> {
  return new Promise((done) => {
    const request = httpGet({ host: "127.0.0.1", port, path, timeout: 2000 }, (response) => {
      let body = "";
      response.on("data", (chunk) => (body += String(chunk)));
      response.on("end", () => done(body));
    });
    request.once("error", () => done(null));
    request.once("timeout", () => {
      request.destroy();
      done(null);
    });
  });
}

/**
 * Poll until the **sidecar** answers on `port` — not until anything does.
 *
 * Waiting on a TCP connect is the check that passes for the wrong reason here: the whole scenario
 * has the developer's own server already listening, so a probe that only asks "is something on
 * this port" reports success on *their* process when the sidecar has collided and died.
 */
async function waitForSidecar(port: number, child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    const body = await fetchBody(port, "/api/flows");
    if (body !== null && !body.includes(HOST_MARKER)) return true;
    await new Promise((sleep) => setTimeout(sleep, 250));
  }
  return false;
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

      it.runIf(managerAvailable(manager))(
        "runs a dev script whose name a shell would otherwise take apart",
        () => {
          // Executed, not pattern-matched: unquoted, `pnpm my script` looks up a script called
          // `my` and `pnpm dev; echo pwned` runs two commands, one of them the developer's shell
          // interpreting text out of their own package.json.
          for (const [devScript, marker] of [
            ["my script", "--from-space-script"],
            ["dev; echo pwned", "--from-metachar-script"],
          ] as const) {
            const rendered = renderNextSteps({ ...MOUNTED, packageManager: manager, devScript });
            const { run } = PACKAGE_MANAGER_COMMAND_FORMS[manager];
            const line = rendered
              .split("\n")
              .map((l) => l.trim())
              .find((l) => l.startsWith(`${run} `));
            expect(line, "the block did not print the dev script line").toBeDefined();
            expect(runPrintedCommand(manager, line!), `\`${line}\` did not reach the script`).toEqual([
              marker,
            ]);
          }
        },
        60_000,
      );

      it.runIf(managerAvailable(manager))(
        "runs a dev script whose name collides with one of the manager's own builtins",
        () => {
          // `pnpm list` prints a dependency tree and `yarn config` errors on a subcommand; in
          // both cases the developer's script never runs and nothing says so. Executed rather
          // than reasoned about, because which names are builtins is the manager's business.
          for (const [devScript, marker] of [
            ["list", "--from-list-script"],
            ["config", "--from-config-script"],
          ] as const) {
            const rendered = renderNextSteps({ ...MOUNTED, packageManager: manager, devScript });
            const { run } = PACKAGE_MANAGER_COMMAND_FORMS[manager];
            const line = rendered
              .split("\n")
              .map((l) => l.trim())
              .find((l) => l.startsWith(`${run} `));
            expect(line).toBeDefined();
            expect(
              runPrintedCommand(manager, line!),
              `\`${line}\` ran the manager's builtin instead of the project's script`,
            ).toEqual([marker]);
          }
        },
        60_000,
      );
    });
  }

  it(
    "starts beside a host already holding fsdev serve's default port",
    async () => {
      // The claim: a second-process host is a project already running a server, and `fsdev serve`
      // falls back to $PORT then 3000 — so the printed command has to name a port of its own or
      // it reliably fails to bind. Proved with two real processes, not by reading the string.
      const host = createServer((_req, res) => res.end(HOST_MARKER));
      await new Promise<void>((resolveListen, rejectListen) => {
        host.once("error", rejectListen);
        host.listen(3000, "127.0.0.1", resolveListen);
      }).catch((err) => {
        throw new Error(
          `Could not occupy port 3000 to stand in for the developer's own server: ${String(err)}`,
        );
      });

      // Take the sidecar's argv out of the block itself, so the test exercises what is printed.
      const second = renderNextSteps({ topology: "second-process", packageManager: "pnpm" });
      const serveLine = second
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.includes("fsdev serve"));
      expect(serveLine, "the block did not print a serve command").toBeDefined();
      const argv = serveLine!.slice(serveLine!.indexOf("fsdev serve") + "fsdev ".length).split(" ");

      const sidecar = spawn(
        resolve(import.meta.dirname, "../node_modules/.bin/tsx"),
        [resolve(import.meta.dirname, "../src/bin.ts"), ...argv],
        { cwd: resolve(import.meta.dirname, "fixtures-config", "valid"), stdio: ["ignore", "pipe", "pipe"] },
      );
      let sidecarOutput = "";
      sidecar.stdout.on("data", (chunk) => (sidecarOutput += String(chunk)));
      sidecar.stderr.on("data", (chunk) => (sidecarOutput += String(chunk)));

      try {
        // Where the command names no port, wait on the one `fsdev serve` actually falls back to.
        // Otherwise a block that dropped `--port` would fail this check with a NaN rather than
        // with the port collision the check exists to catch.
        const named = argv.indexOf("--port");
        const port = named === -1 ? 3000 : Number(argv[named + 1]);
        const up = await waitForSidecar(port, sidecar, 90_000);
        expect(up, `the sidecar never answered on ${port}. Output:\n${sidecarOutput}`).toBe(true);
        // Both alive, and they are two processes: the host still answers its own marker.
        expect(await fetchBody(3000, "/")).toBe(HOST_MARKER);
        expect(sidecar.exitCode).toBeNull();
      } finally {
        sidecar.kill("SIGKILL");
        await new Promise<void>((done) => host.close(() => done()));
      }
    },
    120_000,
  );

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
