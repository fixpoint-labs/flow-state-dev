/**
 * The canonical "next steps" block — the paragraph a developer reads when FSD has just been
 * wired into a project, and the one authored source both entry paths render from.
 *
 * Two shippers print these steps: the brownfield install skill (FIX-1159) and the greenfield
 * `create-flow-state` command (FIX-548). They produce genuinely different text — a pnpm
 * brownfield run prints `pnpm run dev` and `pnpm exec fsdev dev`, greenfield prints `npm run dev`
 * and `npm exec -- fsdev dev` — so the shared artifact is the block's SOURCE, not its output.
 * Each shipper embeds {@link CANONICAL_NEXT_STEPS} verbatim in its own source and substitutes
 * at emit time; {@link assertCanonicalNextSteps} is how each one proves its copy has not
 * drifted. There is exactly one normalization and one equality, exported here, because two
 * shippers cannot drift apart on a comparison neither of them implements.
 *
 * ## Two syntaxes, and nothing else varies
 *
 * - **Values** — `{{run}}`, `{{exec}}`, `{{execSep}}`, `{{devScript}}`, `{{devUrl}}`,
 *   `{{mountPath}}`. Filled from detection (brownfield) or from what the template just wrote
 *   (greenfield). Never hardcoded: a brownfield host may have renamed its dev script, moved its
 *   port, or set a `basePath` that prefixes every route it serves.
 * - **Conditional sections** — `{{#mounted-route}}…{{/mounted-route}}` and
 *   `{{#second-process}}…{{/second-process}}`. The key set is closed at those two topologies.
 *   A mounted-route host runs its own dev server with FSD answering inside it; a second-process
 *   host starts `fsdev serve` alongside the server already there. No package-manager
 *   substitution turns one process list into the other.
 *
 * **Every shipper embeds every branch and renders only its own.** `create-flow-state` never
 * renders `second-process`, and that branch still has to sit in its source identical to
 * canonical, because that is what the comparison reads. Trimming an unreachable branch looks
 * like tidying and breaks the check.
 *
 * ## What the caveats may say
 *
 * The caveats describe what the project does **today** and promise nothing about production.
 * They may not say the app refuses to serve in production, that it will serve normally once
 * authentication is configured, or that any control here is keyed to an environment — all three
 * are false of the code. The bind guard runs only under `fsdev serve`, never in
 * `packages/next`; it keys on the bind address, not on `NODE_ENV`; its enforcement is
 * whole-app; and it never sees a mounted route at all.
 *
 * This constraint is enforced from `test/next-steps.test.ts` rather than trusted, because the
 * equality check above makes canonical the *enforced* text: a shipper that corrected a false
 * claim in its own copy would read as drift and fail. **A pin has a direction, and withdrawals
 * travel against it** — so a false claim has to be kept out of canonical in the first place.
 *
 * ## Command forms, measured rather than assumed
 *
 * Both forms were measured on npm 10.9.7 / pnpm 10.4.1 / yarn 1.22.22 against scripts and a bin
 * that print what actually reached them. `test/next-steps.test.ts` re-runs both tables through
 * the real package managers rather than asserting the strings look right.
 *
 * **`{{exec}}` and `{{execSep}}`** — `npm exec` consumes a leading-dash argument as its own
 * configuration, and so does `yarn exec`:
 *
 * | invocation                                    | argv the bin received            |
 * |-----------------------------------------------|----------------------------------|
 * | `npm exec fsdevish serve --host 127.0.0.1`    | `["serve","127.0.0.1"]` — lost   |
 * | `npm exec -- fsdevish serve --host 127.0.0.1` | `["serve","--host","127.0.0.1"]` |
 * | `pnpm exec fsdevish serve --host 127.0.0.1`   | `["serve","--host","127.0.0.1"]` |
 * | `yarn exec fsdevish serve --host 127.0.0.1`   | `["serve"]` — lost               |
 * | `yarn exec -- fsdevish serve --host 127.0.0.1`| `["serve","--host","127.0.0.1"]` |
 *
 * **Yarn drops the flag too**, which "the separator npm needs and the others do not" did not
 * anticipate — under Yarn the loopback bind would silently not be applied.
 *
 * `{{exec}}` is `npm exec` rather than `npx` so the separator has something to attach to; the
 * two are equivalent otherwise, and `npx fsdev …` needs no separator at all.
 *
 * **`{{run}}` is `<manager> run <script>` for all three, never the shortcut form.** `pnpm <name>`
 * and `yarn <name>` lose to the manager's own builtins, and the script name here is an arbitrary
 * one detected in somebody else's manifest:
 *
 * | invocation         | what ran                                      |
 * |--------------------|-----------------------------------------------|
 * | `pnpm list`        | pnpm's dependency listing — the script never ran |
 * | `pnpm run list`    | the script                                    |
 * | `pnpm why`         | `ERR_PNPM_MISSING_PACKAGE_NAME`               |
 * | `yarn config`      | `error Invalid subcommand`                    |
 * | `yarn list`        | `error No lockfile in this directory`         |
 * | `yarn run config`  | the script                                    |
 *
 * A project whose dev script is called `list`, `config`, `why`, `add` or `link` is unremarkable,
 * and under the shortcut form the printed command silently does something else entirely.
 *
 * ## Why the sidecar names a port
 *
 * `fsdev serve` falls back to `$PORT`, then to 3000. A second-process host is by definition a
 * project already running a server, and 3000 is where it most often is — so the printed command
 * would reliably fail to bind. The block names **4201**: adjacent to the DevTool's 4200, so the
 * pair reads as one thing, and clear of the usual application defaults. A fixed literal rather
 * than a free-port probe, because this text is a canonical string a shipper asserts byte-for-byte
 * — probing at emit time would make it non-deterministic and give a help message a failure mode.
 *
 * ## Invoking the CLI before it is installed
 *
 * The published package is **`@flow-state-dev/fsdev`** and the binary it installs is `fsdev`
 * (from the `bin` key, not from the package name). So `npx @flow-state-dev/fsdev …` is the form
 * that works against a project the CLI is not yet a dependency of; a bare `npx fsdev` resolves
 * nothing. Every command in this block runs **after** the install, where `node_modules/.bin/fsdev`
 * exists, which is why the block prints `{{exec}} fsdev …`.
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
  {{run}} {{devScript}}
      your app, now serving FSD at {{mountPath}}
      → {{devUrl}}

  {{exec}}{{execSep}} fsdev dev
      the FSD DevTool, in a second process
      → http://localhost:4200

  {{exec}}{{execSep}} fsdev run hello send --input '{"userId":"u1","message":"hi"}'
      run the demo flow from your terminal
{{/mounted-route}}
{{#second-process}}
  {{exec}}{{execSep}} fsdev dev
      the FSD API and the DevTool, in one process beside your own server
      → http://localhost:4200

  {{exec}}{{execSep}} fsdev serve --host 127.0.0.1 --port 4201
      the same API without the DevTool
      → http://127.0.0.1:4201
      Both flags are deliberate. --host 127.0.0.1 binds the listener to
      loopback, so nothing off this machine can reach it; --port 4201 keeps
      it clear of 3000, where your own server probably already is.

  {{exec}}{{execSep}} fsdev run hello send --input '{"userId":"u1","message":"hi"}'
      run the demo flow from your terminal

  Your own server is untouched and starts exactly the way it did before.
{{/second-process}}

Worth knowing before you build on this

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

  const values: Record<string, string | undefined> = {
    run: forms.run,
    exec: forms.exec,
    execSep: forms.execSep,
    devScript: options.devScript === undefined ? undefined : shellQuote(options.devScript),
    devUrl: options.devUrl,
    mountPath: options.mountPath,
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
  const difference = firstDifference(embedded);
  if (difference === null) return;
  throw new Error(
    `${label} has drifted from the canonical next-steps block in @flow-state-dev/fsdev: ${difference}\n` +
      `Copy CANONICAL_NEXT_STEPS across verbatim, including the branch this shipper never renders.`,
  );
}
