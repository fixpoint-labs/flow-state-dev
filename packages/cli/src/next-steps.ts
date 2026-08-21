/**
 * The canonical "next steps" block — the paragraph a developer reads when FSD has just been
 * wired into a project, and the one authored source both entry paths render from.
 *
 * Two shippers print these steps: the brownfield install skill and the greenfield
 * `create-flow-state` command. They produce genuinely different text — a pnpm brownfield run
 * prints `pnpm run dev`, greenfield prints `npm run dev` — so the shared artifact is the block's
 * SOURCE, not its output. Each shipper embeds {@link CANONICAL_NEXT_STEPS} verbatim and
 * substitutes at emit time; {@link assertCanonicalNextSteps} proves its copy has not drifted.
 *
 * **Values** — `{{run}}`, `{{runSep}}`, `{{exec}}`, `{{execSep}}`, `{{devScript}}`, `{{devUrl}}`,
 * `{{mountPath}}`, `{{devPort}}`, `{{servePort}}`. **Conditional sections** — `{{#mounted-route}}`
 * and `{{#second-process}}`, a closed set of two, because a mounted-route host runs FSD inside the
 * server it already has and a second-process host starts one beside it. **Every shipper embeds
 * every branch and renders only its own** — trimming an unreachable branch looks like tidying and
 * fails the comparison, which is what the comparison is for.
 *
 * **The caveats describe what the project does today and promise nothing about production** —
 * enforced in `test/next-steps.test.ts`, because equality makes canonical the *enforced* text and
 * a false claim in it cannot be corrected downstream.
 *
 * ## Command forms, measured rather than assumed
 *
 * Measured on npm 10.9.7 / pnpm 10.4.1 / yarn 1.22.22 against scripts and a bin — named `fsdev`,
 * like the real one — that print what actually reached them. `test/next-steps.test.ts` re-runs
 * every working form below through the real package managers rather than asserting the strings
 * look right; the losing forms are what those checks go red on when the fix is removed.
 *
 * **`{{exec}}` and `{{execSep}}`** — `npm exec` consumes a leading-dash argument as its own
 * configuration, and so does `yarn exec`:
 *
 * | invocation                                    | argv the bin received            |
 * |-----------------------------------------------|----------------------------------|
 * | `npm exec fsdev serve --host 127.0.0.1`    | `["serve","127.0.0.1"]` — lost   |
 * | `npm exec -- fsdev serve --host 127.0.0.1` | `["serve","--host","127.0.0.1"]` |
 * | `pnpm exec fsdev serve --host 127.0.0.1`   | `["serve","--host","127.0.0.1"]` |
 * | `yarn exec fsdev serve --host 127.0.0.1`   | `["serve"]` — lost               |
 * | `yarn exec -- fsdev serve --host 127.0.0.1`| `["serve","--host","127.0.0.1"]` |
 *
 * **Yarn drops the flag too**, which "the separator npm needs and the others do not" did not
 * anticipate — under Yarn the loopback bind would silently not be applied.
 *
 * **`{{run}}` is `<manager> run <script>` for all three, never the shortcut form.** The script
 * name is an arbitrary one detected in somebody else's manifest, and the shortcut loses to the
 * manager's own builtins:
 *
 * | invocation         | what ran                                         |
 * |--------------------|--------------------------------------------------|
 * | `pnpm list`        | pnpm's dependency listing — the script never ran |
 * | `pnpm run list`    | the script                                       |
 * | `pnpm why`         | `ERR_PNPM_MISSING_PACKAGE_NAME`                  |
 * | `yarn config`      | `error Invalid subcommand`                       |
 * | `yarn list`        | `error No lockfile in this directory`            |
 * | `yarn run config`  | the script                                       |
 *
 * ## Ports: an invariant, not a list of fixes
 *
 * **Every `fsdev` command this block prints binds its port explicitly, from one range the block
 * owns: {@link RESERVED_PORTS}.** No bare bind survives anywhere in the emitted text.
 *
 * Stated as an invariant because fixing instances does not converge — `fsdev serve` defaults to
 * 3000 (a Next host holds it), `fsdev dev` to 4200 (an Angular host holds it), and each pin opens
 * a smaller hole. Enforced by {@link assertCanonicalNextSteps}, the call every shipper already
 * makes.
 *
 * **These are defaults chosen to be unlikely to collide, not ports anything can guarantee are
 * free.** No fixed number clears a port; a machine can have any process on any of them. So the
 * block tells the reader they can pass a different `--port`, which is worth more than any number
 * we could pick. The one collision visible at emit time *is* handled: `{{devUrl}}` names the
 * host's own port, and {@link allocatePorts} shifts off it deterministically. That uses an input
 * we already hold, so the text stays a pure function of its inputs — unlike an availability
 * probe, which would make a canonical string non-deterministic and give a help message a failure
 * mode of its own.
 */

/** The two host topologies FSD arrives in. The key set is closed; a third is a cross-cutting question. */
export type NextStepsTopology = "mounted-route" | "second-process";

/** The package managers the block can render commands for. Anything else refuses before a run starts. */
export type NextStepsPackageManager = "npm" | "pnpm" | "yarn";

/** The three command-form substitutions a package manager decides. */
export interface PackageManagerCommandForms {
  /** `{{run}}` — how this manager runs a package script. */
  run: string;
  /** `{{exec}}` — how this manager runs a locally-installed binary. */
  exec: string;
  /**
   * `{{execSep}}` — the option separator this manager needs so a leading-dash argument reaches
   * the binary instead of the manager. Empty where none is needed; always emitted directly after
   * `{{exec}}`, so a command with no options renders one harmless extra token rather than
   * needing a second conditional.
   */
  execSep: string;
}

/** Command forms per supported manager. Measured, not assumed — see the module header's table. */
export const PACKAGE_MANAGER_COMMAND_FORMS: Readonly<
  Record<NextStepsPackageManager, Readonly<PackageManagerCommandForms>>
> = {
  npm: { run: "npm run", exec: "npm exec", execSep: " --" },
  pnpm: { run: "pnpm run", exec: "pnpm exec", execSep: "" },
  yarn: { run: "yarn run", exec: "yarn exec", execSep: " --" },
};

/** Values a shipper fills in. The mounted-route three are absent on a second-process host. */
export interface NextStepsValues {
  /** The host's own dev script name — from detection, or from what the template wrote. */
  devScript?: string;
  /** Where that script actually serves. Never an assumed `localhost:3000`. */
  devUrl?: string;
  /** The path the mount answers on, `basePath` included. Never the bare `/api/flows`. */
  mountPath?: string;
}

/** Everything {@link renderNextSteps} needs. */
export interface RenderNextStepsOptions extends NextStepsValues {
  topology: NextStepsTopology;
  packageManager: NextStepsPackageManager;
}

/**
 * The canonical block. One text, two conditional branches, six value placeholders.
 *
 * Edit this and every shipper's embedded copy fails its own comparison until it is updated,
 * which is the point: the steps, what each process is for, the ports they land on, and the
 * caveats are the invariant content. Only the commands vary.
 */
export const CANONICAL_NEXT_STEPS = `Next steps

{{#mounted-route}}
  {{run}}{{runSep}} {{devScript}}
      your app, now serving FSD at {{mountPath}}
      → {{devUrl}}

  {{exec}}{{execSep}} fsdev dev --port {{devPort}}
      the FSD DevTool, in a second process
      → http://localhost:{{devPort}}

  {{exec}}{{execSep}} fsdev run hello send --input '{"userId":"u1","message":"hi"}'
      run the demo flow from your terminal
{{/mounted-route}}
{{#second-process}}
  {{exec}}{{execSep}} fsdev dev --port {{devPort}}
      the FSD API and the DevTool, in one process beside your own server
      → http://localhost:{{devPort}}

  {{exec}}{{execSep}} fsdev serve --host 127.0.0.1 --port {{servePort}}
      the same API without the DevTool
      → http://127.0.0.1:{{servePort}}
      Keep the --host 127.0.0.1. It binds the listener to loopback, so nothing
      off this machine can reach it.

  {{exec}}{{execSep}} fsdev run hello send --input '{"userId":"u1","message":"hi"}'
      run the demo flow from your terminal

  Your own server is untouched and starts exactly the way it did before.
{{/second-process}}

Worth knowing before you build on this

  The ports above are defaults, picked to be unlikely to clash with what you
  already run. Nothing here can know they are free. If one is taken, pass a
  different --port.

  The demo flow is closed over HTTP. A request to it has to carry
  Authorization: Bearer $FSD_DEMO_TOKEN, and that value is in .env.local.
  A request without it is refused, and no model call is made. Only the demo
  flow is affected — everything else this project serves is unchanged.

  fsdev run never authenticates. It executes in-process as a local, trusted
  path and does not look at the token at all, which is why the command above
  works without one. That is what the CLI does, not a gap in the HTTP route.

  Sessions are kept on disk by the development file store. It expects one
  process at a time: two FSD servers over the same data directory can each
  accept the same write, so do not drive one session from both at once.

  A shared secret is not authentication, and a development file store is not
  a database. Replace both before this project serves anyone but you.

  AGENTS.md now tells your coding assistant how to write FSD flows here.
`;

/** Every topology key the conditional syntax accepts. */
const TOPOLOGIES: readonly NextStepsTopology[] = ["mounted-route", "second-process"];

/** The contiguous range this block owns. See "Ports: an invariant, not a list of fixes" above. */
const RESERVED_PORTS = { first: 4210, last: 4219 };

/** Every port in the reserved range, in order. */
function reservedRange(): number[] {
  const ports: number[] = [];
  for (let port = RESERVED_PORTS.first; port <= RESERVED_PORTS.last; port++) ports.push(port);
  return ports;
}

/**
 * Pick the two ports the block prints, shifting off the host's own if it happens to sit in our
 * range.
 *
 * This is the **one** collision visible at emit time. `devUrl` is a value the caller already
 * supplies — the URL the project's own dev server serves on — so if that names 4210 we can see,
 * without probing anything, that the command we are about to print will fail. Printing it anyway
 * is indefensible.
 *
 * Deterministic and pure: same inputs, same ports, so the emitted text stays a function of its
 * arguments and the canonical assertion still holds. It says nothing about *other* ports being
 * free, which is why the block also tells the reader how to pass their own.
 */
function allocatePorts(devUrl: string | undefined): { devPort: string; servePort: string } {
  const hostPort = hostPortOf(devUrl);
  const free = reservedRange().filter((port) => port !== hostPort);
  return { devPort: String(free[0]), servePort: String(free[1]) };
}

/**
 * The port a dev URL serves on, or `null` when it names none. Parsed with `URL`, which knows where
 * an authority ends — an IPv6 host is why a regex does not.
 */
function hostPortOf(devUrl: string | undefined): number | null {
  if (devUrl === undefined) return null;
  try {
    const port = new URL(devUrl).port;
    return port === "" ? null : Number(port);
  } catch {
    // Not a URL we can parse. Nothing is claimed about its port rather than guessing at one.
    return null;
  }
}

/**
 * `fsdev` subcommands that start no listener. **Default-deny**: anything not named here has to
 * bind explicitly, so a subcommand added later is covered without anyone remembering to add it.
 */
const NON_BINDING_SUBCOMMANDS = new Set(["run", "block", "chat", "benchmark"]);

/**
 * Every `fsdev` command line in the block, so the invariant can be checked over the source.
 *
 * Scoped to `fsdev` commands on purpose. `{{run}} {{devScript}}` also binds a port, but it is the
 * developer's own script and its port is a fact detection *reports* (`{{devUrl}}`) rather than one
 * we get to choose — adding `--port` to somebody else's script would be the opposite of the rule.
 */
function fsdevCommandLines(text: string): string[] {
  return text.split("\n").filter((line) => /(^|\s)fsdev\s+\w/.test(line));
}

/**
 * Throw if any `fsdev` command in the block starts a listener without naming a port from the
 * reserved range.
 *
 * Run over canonical from {@link assertCanonicalNextSteps} — the call every shipper already
 * makes — so a bare bind added by a future edit fails a suite instead of reaching a developer as
 * an `EADDRINUSE` on the one command they were told to type.
 */
export function assertEveryPortIsNamed(text: string): void {
  for (const line of fsdevCommandLines(text)) {
    const subcommand = /(?:^|\s)fsdev\s+(\w[\w-]*)/.exec(line)?.[1];
    if (subcommand === undefined || NON_BINDING_SUBCOMMANDS.has(subcommand)) continue;

    // In the source the port is a placeholder; in the emitted text it is a number. Both are
    // "named" — a bare bind is what this refuses, in either.
    if (/--port[= ]\{\{\w+\}\}/.test(line)) continue;
    const port = /--port[= ](\d+)/.exec(line)?.[1];
    if (port === undefined) {
      throw new Error(
        `The next-steps block prints \`fsdev ${subcommand}\` with no --port:\n  ${line.trim()}\n` +
          `Every fsdev command in this block names its port, from ${RESERVED_PORTS.first}–${RESERVED_PORTS.last}. ` +
          `A bare bind takes whichever default that command has, and the developer's own server ` +
          `is often already on it.`,
      );
    }
    const value = Number(port);
    if (value < RESERVED_PORTS.first || value > RESERVED_PORTS.last) {
      throw new Error(
        `The next-steps block binds port ${value}, outside the range this block owns ` +
          `(${RESERVED_PORTS.first}–${RESERVED_PORTS.last}):\n  ${line.trim()}\n` +
          `Ports live in one contiguous range so there is a single place to move them.`,
      );
    }
  }
}

/** Matches one conditional section, including the newline that ends each delimiter line. */
function sectionPattern(key: string): RegExp {
  return new RegExp(`^\\{\\{#${key}\\}\\}\\n([\\s\\S]*?)^\\{\\{/${key}\\}\\}\\n`, "m");
}

/** Any `{{…}}` token left in a string — an unfilled value or a stray delimiter. */
const PLACEHOLDER_PATTERN = /\{\{[^}]*\}\}/g;

/**
 * Everything a POSIX shell passes through untouched. Deliberately narrow: `~` (home expansion),
 * `{}` (brace expansion) and `,` are outside it even though a script name rarely contains them.
 */
const SHELL_SAFE = /^[A-Za-z0-9._:/@=+-]+$/;

/**
 * Quote a value that lands in a **command position** in the rendered block.
 *
 * `devScript` is the one such value, and it is read out of somebody else's `package.json` — so in
 * the brownfield case it is input we did not author. A name carrying a space renders as two
 * arguments and the printed command addresses the wrong script; one carrying `;`, `&&`, `$(…)` or
 * a backtick is interpreted by the shell the developer pastes it into. Single quotes are the only
 * POSIX construct that suspends *all* expansion, and `'\''` is how a literal quote survives them.
 *
 * The common case stays readable: `dev` and `dev:web` come back unquoted.
 *
 * `devUrl` and `mountPath` are not quoted, and that is not an oversight — neither sits in a
 * command position. They are display text on their own lines, so a shell never reads them.
 */
function shellQuote(value: string): string {
  if (value.length > 0 && SHELL_SAFE.test(value)) return value;
  return `'${value.split("'").join(`'\\''`)}'`;
}

/**
 * The end-of-options separator a **script name** needs — the sibling of `{{execSep}}`.
 *
 * `{{execSep}}` exists because a leading-dash *argument* is eaten by the manager's option parser.
 * A script *name* has the identical problem and never got the sibling: `npm run --help` prints
 * npm's help, exits 0, and never runs the script, and quoting does not reach it because the shell
 * hands `--help` to npm intact. Measured on npm, pnpm and Yarn — `<manager> run -- --help` runs
 * the script on all three.
 *
 * **Conditional on the name, not on the manager**, which is what keeps the common path clean.
 * Yarn Classic warns whenever an explicit `--` is present, so emitting it always would put a
 * deprecation line in front of every ordinary render; emitting it only for a dash-named script
 * confines the warning to the rare command. `test/next-steps.test.ts` pins that behaviour by
 * executing it, so a change in those semantics goes red here rather than reaching a developer.
 */
function runSeparatorFor(devScript: string | undefined): string {
  return devScript !== undefined && devScript.startsWith("-") ? " --" : "";
}

/**
 * Render the block for one topology and one package manager.
 *
 * Throws when a value the rendered branch needs was not supplied, rather than emitting a
 * `{{devScript}}` a developer would then type. The branch that is not rendered is dropped
 * whole, so a second-process host never needs `devScript`, `devUrl` or `mountPath` — those
 * facts are ones that topology never prints.
 */
export function renderNextSteps(options: RenderNextStepsOptions): string {
  const forms = PACKAGE_MANAGER_COMMAND_FORMS[options.packageManager];
  if (forms === undefined) {
    throw new Error(
      `Unsupported package manager "${options.packageManager}" — the next-steps block renders ` +
        `commands for ${Object.keys(PACKAGE_MANAGER_COMMAND_FORMS).join(", ")} and nothing else.`,
    );
  }
  if (!TOPOLOGIES.includes(options.topology)) {
    throw new Error(
      `Unknown topology "${options.topology}" — the block has branches for ${TOPOLOGIES.join(" and ")}.`,
    );
  }

  // Select the branch first: what a value is *required* for is decided by what survives here.
  let text = CANONICAL_NEXT_STEPS;
  for (const key of TOPOLOGIES) {
    const match = sectionPattern(key).exec(text);
    if (match === null) {
      throw new Error(`The canonical next-steps block is missing its "${key}" section.`);
    }
    // A function replacement, not a string: the second-process branch contains `$PORT`, and
    // `String.replace` reads `$` in a replacement string as a capture reference.
    const kept = key === options.topology ? match[1]! : "";
    text = text.replace(sectionPattern(key), () => kept);
  }

  const ports = allocatePorts(options.devUrl);
  const values: Record<string, string | undefined> = {
    run: forms.run,
    exec: forms.exec,
    execSep: forms.execSep,
    runSep: runSeparatorFor(options.devScript),
    devScript: options.devScript === undefined ? undefined : shellQuote(options.devScript),
    devUrl: options.devUrl,
    mountPath: options.mountPath,
    devPort: ports.devPort,
    servePort: ports.servePort,
  };

  const missing: string[] = [];
  const rendered = text.replace(PLACEHOLDER_PATTERN, (token) => {
    const name = token.slice(2, -2);
    const value = values[name];
    if (value === undefined) {
      missing.push(name);
      return token;
    }
    return value;
  });

  if (missing.length > 0) {
    throw new Error(
      `The ${options.topology} next-steps block needs ${[...new Set(missing)].sort().join(", ")}, ` +
        `which the caller did not supply. Fill them from detection — a printed placeholder is a ` +
        `command the project cannot run.`,
    );
  }

  // The invariant holds over what is actually emitted, not only over the source: a placeholder is
  // acceptable in canonical, a bare bind is acceptable nowhere.
  assertEveryPortIsNamed(rendered);
  return rendered;
}

/**
 * Normalize a copy of the block for comparison: line endings, trailing whitespace, a uniform
 * leading indent (a shipper may embed the block inside indented Markdown), and blank lines at
 * either end. Deliberately nothing else — collapsing interior blank lines or reflowing text
 * would let a shipper drop structure and still pass.
 */
function normalize(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/, ""));
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const indents = lines
    .filter((line) => line !== "")
    .map((line) => line.length - line.trimStart().length);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => (line === "" ? line : line.slice(common))).join("\n");
}

/**
 * The first line on which a copy differs from canonical, or `null` when it does not.
 *
 * Equality over the **whole** block, every branch included — never presence and never a
 * substring. The regression this exists to catch is a copy with the branch that shipper cannot
 * reach trimmed out of it, which a presence check passes.
 *
 * Comparing line by line after a length check means the loop always finds a difference when the
 * texts differ, so there is no "same lines, different length" case to report.
 */
function firstDifference(embedded: string): string | null {
  const actual = normalize(embedded);
  const expected = normalize(CANONICAL_NEXT_STEPS);
  if (actual === expected) return null;

  const actualLines = actual.split("\n");
  const expectedLines = expected.split("\n");
  const limit = Math.max(actualLines.length, expectedLines.length);
  for (let i = 0; i < limit; i++) {
    if (actualLines[i] === expectedLines[i]) continue;
    return (
      `line ${i + 1} differs.\n` +
      `  canonical: ${expectedLines[i] === undefined ? "<end of block>" : JSON.stringify(expectedLines[i])}\n` +
      `  embedded:  ${actualLines[i] === undefined ? "<end of block>" : JSON.stringify(actualLines[i])}`
    );
  }
  /* c8 ignore next */
  throw new Error("unreachable: the texts differ but no line does");
}

/**
 * Throw unless `embedded` is the canonical block. **The only comparison surface** — a shipper
 * asserts, it never inspects a verdict, so there is one thing to call and one way to fail.
 *
 * The assertion is exported rather than run here over every shipper's copy on purpose: a check
 * written here cannot tell *not yet* from *never*. Demanding a copy that has not shipped yet
 * fails; tolerating its absence passes forever. So each shipper invokes this from its own test
 * suite, and the assertion lands exactly when the copy does.
 *
 * @param label how to name the copy in the failure message (e.g. the file it was read from)
 */
export function assertCanonicalNextSteps(embedded: string, label = "the embedded next-steps block"): void {
  // The port invariant is checked here, over canonical, rather than in a test of its own: this is
  // the call every shipper already makes, so an edit that adds a bare bind goes red in each of
  // their suites too — there is nowhere for it to land quietly.
  assertEveryPortIsNamed(CANONICAL_NEXT_STEPS);
  const difference = firstDifference(embedded);
  if (difference === null) return;
  throw new Error(
    `${label} has drifted from the canonical next-steps block in @flow-state-dev/fsdev: ${difference}\n` +
      `Copy CANONICAL_NEXT_STEPS across verbatim, including the branch this shipper never renders.`,
  );
}
