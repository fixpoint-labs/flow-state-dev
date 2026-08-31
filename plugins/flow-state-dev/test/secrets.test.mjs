/**
 * Resolutions 9 and 10 — the effective status of every secret variable, per runtime, and the set
 * of files about to hold one.
 *
 * Every case here has a broken implementation that passes a plausible-looking check. A rule
 * phrased "is the variable present anywhere?" matches a project whose nearer file holds an empty
 * `KEY=` while a parent holds the real one — and reports it configured while resolution produces
 * `""` and the model call fails. A tracking check aimed at the write root's own file passes on a
 * project where the line to fill is an ancestor's, and the developer then pastes a live key into
 * a committed file because we pointed at it.
 */
import { afterAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildReport } from "../skills/install-fsd/detect/report.mjs";
import { resolveForCli, resolveForNextDev, resolveSecrets } from "../skills/install-fsd/detect/secrets.mjs";
import { cleanupTrees, initGit, makeTree, manifest, nextManifest } from "./helpers.mjs";

afterAll(cleanupTrees);

const codes = (report) => report.refusals.map((r) => r.code);
const page = "export default function Page() { return null }\n";
const KEY = "OPENAI_API_KEY";

describe("two tie-breaks, opposite directions", () => {
  it("takes the LAST assignment within a file", () => {
    const root = makeTree({
      "package.json": manifest({ packageManager: "npm@10.0.0" }),
      ".env.local": `${KEY}=first\n${KEY}=second\n`,
    });
    expect(resolveForCli(KEY, root, {})).toMatchObject({ status: "non-empty", path: join(root, ".env.local") });
  });

  it("takes the NEAREST file across the walk, even when it is empty", () => {
    // The nearer file decides, so an empty `KEY=` masks a working parent. A rule that asks the
    // chain "is it non-empty anywhere?" says yes here while resolution produces "".
    const root = makeTree({
      ".env.local": `${KEY}=parent-secret\n`,
      "package.json": manifest({ workspaces: ["apps/*"] }),
      "apps/web/package.json": manifest({ packageManager: "npm@10.0.0" }),
      "apps/web/.env.local": `${KEY}=\n`,
    });
    const app = join(root, "apps/web");
    expect(resolveForCli(KEY, app, {})).toMatchObject({ status: "empty", path: join(app, ".env.local") });
  });

  it("lets the inherited environment outrank every file, in both runtimes", () => {
    const root = makeTree({
      "package.json": nextManifest(),
      ".env.local": `${KEY}=\n`,
    });
    const env = { [KEY]: "exported" };
    expect(resolveForCli(KEY, root, env)).toMatchObject({ status: "non-empty", from: "the inherited environment" });
    expect(resolveForNextDev(KEY, root, env)).toMatchObject({ status: "non-empty", from: "the inherited environment" });
  });
});

describe("the two runtimes search differently, and the report says so", () => {
  it("next dev reads .env.development.local BEFORE .env.local", () => {
    // A files-only scan reports `absent` for a token in .env.development.local, then generates a
    // second one Next will ignore — and every request carrying it 401s with nothing to explain why.
    const root = makeTree({
      "package.json": nextManifest(),
      ".env.development.local": "FSD_DEMO_TOKEN=from-dev-local\n",
    });
    expect(resolveForNextDev("FSD_DEMO_TOKEN", root, {})).toMatchObject({
      status: "non-empty",
      path: join(root, ".env.development.local"),
    });
  });

  it("next dev reads one directory; our CLI walks up — and the divergence is reported", () => {
    const root = makeTree({
      ".env.local": `${KEY}=parent-secret\n`,
      "package.json": manifest({ workspaces: ["apps/*"] }),
      "apps/web/package.json": nextManifest(),
      "apps/web/app/page.tsx": page,
    });
    const app = join(root, "apps/web");
    const secrets = resolveSecrets(app, "next", {});
    expect(secrets[KEY].cli).toMatchObject({ status: "non-empty", path: join(root, ".env.local") });
    expect(secrets[KEY].next).toMatchObject({ status: "absent" });
    // The same input, two answers, because two loaders search differently. Reported, not averaged.
    expect(secrets[KEY].divergent).toBe(true);
  });

  it("reports the same ancestor key as reachable on a plain-Node host", () => {
    const root = makeTree({
      ".env.local": `${KEY}=parent-secret\n`,
      "package.json": manifest({ workspaces: ["apps/*"] }),
      "apps/api/package.json": manifest({ packageManager: "npm@10.0.0" }),
    });
    const secrets = resolveSecrets(join(root, "apps/api"), "node", {});
    expect(secrets[KEY].cli.status).toBe("non-empty");
    expect(secrets[KEY].next).toBe(null);
    expect(secrets[KEY].divergent).toBe(false);
  });

  it("reports a variable exported in the shell as configured for this shell, not absent", () => {
    const root = makeTree({ "package.json": manifest({ packageManager: "npm@10.0.0" }) });
    const report = buildReport(root, { env: { [KEY]: "exported" } });
    expect(report.secrets[KEY].cli).toMatchObject({
      status: "non-empty",
      from: "the inherited environment",
      path: null,
    });
  });
});

describe("each runtime is parsed by its own loader's grammar", () => {
  it("sees an `export`-prefixed assignment on the Next side and not on the CLI's", () => {
    // dotenv's key regex carries an explicit `(?:export\\s+)?`; our CLI's parser splits on the
    // first `=` and would set a variable literally named `export FSD_DEMO_TOKEN`. Reporting the
    // token absent is what made the run generate a second one Next would then ignore.
    const root = makeTree({
      "package.json": nextManifest(),
      ".env.local": "export FSD_DEMO_TOKEN=already-set\n",
    });
    expect(resolveForNextDev("FSD_DEMO_TOKEN", root, {})).toMatchObject({ status: "non-empty" });
    expect(resolveForCli("FSD_DEMO_TOKEN", root, {})).toMatchObject({ status: "absent" });
    expect(resolveSecrets(root, "next", {}).FSD_DEMO_TOKEN.divergent).toBe(true);
  });

  it("reports a value Next would expand as unreadable, not as configured", () => {
    // `@next/env` runs every parsed file through dotenv's `expand`, so this resolves to the empty
    // string and the demo flow rejects every request — while a report that called it non-empty
    // would say the credential was configured.
    const root = makeTree({
      "package.json": nextManifest(),
      ".env.local": "FSD_DEMO_TOKEN=$DOES_NOT_EXIST\n",
    });
    expect(resolveForNextDev("FSD_DEMO_TOKEN", root, {})).toMatchObject({ status: "unreadable" });
    // Our CLI does not expand, so it genuinely sees a literal — the divergence is real, not a bug.
    expect(resolveForCli("FSD_DEMO_TOKEN", root, {})).toMatchObject({ status: "non-empty" });
  });

  it("keeps an escaped dollar readable, because dotenv does not expand those", () => {
    const root = makeTree({
      "package.json": nextManifest(),
      ".env.local": "FSD_DEMO_TOKEN=\\$LITERAL\n",
    });
    expect(resolveForNextDev("FSD_DEMO_TOKEN", root, {})).toMatchObject({ status: "non-empty" });
  });

  it("reports a single-quoted Next expansion as unreadable, because expand runs after quotes are stripped", () => {
    // dotenv.parse strips the quotes, then @next/env's expand() interpolates the bare `$VAR`.
    // Treating `'$DOES_NOT_EXIST'` as a literal leaves the report saying the token is configured
    // while Next authenticates with the empty string.
    const root = makeTree({
      "package.json": nextManifest(),
      ".env.local": "FSD_DEMO_TOKEN='$DOES_NOT_EXIST'\n",
    });
    expect(resolveForNextDev("FSD_DEMO_TOKEN", root, {})).toMatchObject({ status: "unreadable" });
  });
});

describe("the destination is chosen from both loaders, not one", () => {
  it("includes the file next dev decides from, and checks it for git tracking", () => {
    // Fix-applied-to-one-of-a-pair: destination selection consulted only the CLI answer, so on a
    // mounted-route host the run appended to `.env.local` while Next kept preferring its own
    // empty assignment in `.env.development.local` — and that deciding file never reached the
    // tracked-by-git check.
    const root = makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
      ".env.development.local": `${KEY}=\n`,
      ".gitignore": ".env.local\n",
    });
    initGit(root);
    const report = buildReport(root, { providerKey: KEY, env: {} });
    const paths = report.secretFiles.map((f) => f.path);
    expect(paths).toContain(join(root, ".env.development.local"));
    const deciding = report.secretFiles.find((f) => f.path === join(root, ".env.development.local"));
    expect(deciding.reasons.join(" ")).toContain("next dev");
    // …and it is a tracked file, so the run refuses rather than pointing a live key at it.
    expect(codes(report)).toContain("secret-file-tracked");
    expect(report.refusals.find((r) => r.code === "secret-file-tracked").message).toContain(
      ".env.development.local",
    );
  });

  it("does not drag the Next answer in on a plain-Node host, which has no Next resolution", () => {
    const root = makeTree({
      "package.json": manifest({ packageManager: "npm@10.0.0" }),
      ".env.development.local": `${KEY}=\n`,
      ".gitignore": ".env.local\n",
    });
    initGit(root);
    const report = buildReport(root, { providerKey: KEY });
    expect(report.secretFiles.map((f) => f.path)).not.toContain(join(root, ".env.development.local"));
  });
});

describe("all three provider keys are resolved before anyone is asked which one they want", () => {
  it("carries a resolution for each candidate, by name", () => {
    const root = makeTree({ "package.json": manifest({ packageManager: "npm@10.0.0" }) });
    const report = buildReport(root, { env: {} });
    for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]) {
      expect(report.secrets[key]).toBeDefined();
      expect(report.secrets[key].cli.status).toBe("absent");
    }
    expect(report.secrets.FSD_DEMO_TOKEN).toBeDefined();
  });

  it("fires a provider-independent refusal with no provider supplied at all", () => {
    // Refusals that do not depend on the answer must be able to fire before it is asked, or a
    // Pages Router project gets a provider prompt and then a refusal.
    const root = makeTree({ "package.json": nextManifest(), "pages/index.tsx": page });
    const report = buildReport(root, { providerKey: null });
    expect(codes(report)).toContain("next-unsupported");
  });
});

describe("resolution 10 is a set of files, and every one is checked for git tracking", () => {
  it("refuses when the file that will be filled is tracked, naming THAT path", () => {
    // The credential-into-git composition: the fill instruction points at the ancestor while a
    // tracking check aimed at the write root sees a file that does not exist, reports untracked,
    // and lets the run continue.
    const root = makeTree({
      ".env.local": `${KEY}=\n`,
      "package.json": manifest({ workspaces: ["apps/*"], packageManager: "npm@10.0.0" }),
      "apps/web/package.json": manifest({ packageManager: "npm@10.0.0" }),
    });
    initGit(root);
    const report = buildReport(join(root, "apps/web"), { providerKey: KEY, env: {} });
    expect(codes(report)).toContain("secret-file-tracked");
    const refusal = report.refusals.find((r) => r.code === "secret-file-tracked");
    expect(refusal.message).toContain(join(root, ".env.local"));
    expect(refusal.remediation).toBe(`git rm --cached ${join(root, ".env.local")}`);
  });

  it("refuses when the TOKEN's file is tracked even though the provider key's is clean", () => {
    // A singular resolution 10 passes here — it looked at the provider key's file, found it
    // clean, and let a generated secret land in a committed file.
    const root = makeTree({
      ".env.local": `${KEY}=parent-secret\n`,
      "package.json": manifest({ workspaces: ["apps/*"] }),
      "apps/web/package.json": manifest({ packageManager: "npm@10.0.0" }),
      "apps/web/.env.local": "# nothing here yet\n",
      ".gitignore": "node_modules\n",
    });
    // Commit only the app's env file, leaving the ancestor's untracked.
    initGit(root, { commit: ["apps/web/.env.local", "package.json"] });
    const report = buildReport(join(root, "apps/web"), { providerKey: KEY });
    const refusal = report.refusals.find((r) => r.code === "secret-file-tracked");
    expect(refusal, "the token's own file being tracked must refuse").toBeDefined();
    expect(refusal.message).toContain(join(root, "apps/web", ".env.local"));
    expect(refusal.message).toContain("FSD_DEMO_TOKEN");
  });

  it("does not refuse when nothing that will hold a secret is tracked", () => {
    const root = makeTree({
      "package.json": manifest({ packageManager: "npm@10.0.0" }),
      ".gitignore": ".env.local\n",
    });
    initGit(root);
    expect(codes(buildReport(root, { providerKey: KEY }))).not.toContain("secret-file-tracked");
  });
});

describe("the report never carries a secret value, for any variable", () => {
  it("keeps every seeded value out of the serialized report and out of the prose", async () => {
    // Searched for in the whole serialized report rather than in named fields, so a value that
    // arrives in a field nobody thought of still fails. Scoped to every secret rather than to the
    // one we generate: the provider key is older, travels the same walk, and is somebody else's
    // live credential.
    const root = makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
      ".env.local": `${KEY}=sk-SEEDED-PROVIDER-VALUE\nFSD_DEMO_TOKEN=SEEDED-TOKEN-VALUE\n`,
      ".gitignore": ".env.local\n",
    });
    initGit(root);
    const report = buildReport(root, { providerKey: KEY });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("sk-SEEDED-PROVIDER-VALUE");
    expect(serialized).not.toContain("SEEDED-TOKEN-VALUE");
    // …while the status and the deciding path both do appear, or the report would be useless.
    expect(serialized).toContain("non-empty");
    expect(serialized).toContain(join(root, ".env.local"));

    const { renderReport } = await import("../skills/install-fsd/detect/render.mjs");
    const prose = renderReport(report);
    expect(prose).not.toContain("sk-SEEDED-PROVIDER-VALUE");
    expect(prose).not.toContain("SEEDED-TOKEN-VALUE");
    expect(prose).toContain("non-empty");
  });

  it("keeps values out of the report even when detection runs through the script's own entry point", () => {
    const root = makeTree({
      "package.json": manifest({ packageManager: "npm@10.0.0" }),
      ".env.local": "FSD_DEMO_TOKEN=CLI-SEEDED-VALUE\n",
      ".gitignore": ".env.local\n",
    });
    initGit(root);
    const stdout = execFileSync(
      process.execPath,
      [join(import.meta.dirname, "../skills/install-fsd/detect/detect.mjs"), root, "--json"],
      { encoding: "utf-8" },
    );
    expect(stdout).not.toContain("CLI-SEEDED-VALUE");
    expect(JSON.parse(stdout).secrets.FSD_DEMO_TOKEN.cli.status).toBe("non-empty");
  });
});

describe("the demo token is reused, never rotated, and never adopted from an ancestor", () => {
  it("reuses a token already in the write root's own file", () => {
    const root = makeTree({
      "package.json": manifest({ packageManager: "npm@10.0.0" }),
      ".env.local": "FSD_DEMO_TOKEN=already-here\n",
      ".gitignore": ".env.local\n",
    });
    initGit(root);
    const report = buildReport(root);
    const own = report.secretFiles.find((f) => f.path === join(root, ".env.local"));
    expect(own.reasons.join(" ")).toContain("reused");
  });

  it.each([
    ["non-empty", "FSD_DEMO_TOKEN=another-apps-token\n"],
    ["empty", "FSD_DEMO_TOKEN=\n"],
  ])("never writes a generated secret outside the app — ancestor assignment is %s", (_kind, ancestor) => {
    // **The pair, tested as a pair.** The non-empty branch already chose the app's own file; the
    // EMPTY one picked the ancestor and would have written a shared auth token into a directory
    // that is not this project, where every sibling app inherits it. The write barrier violated
    // on an entirely ordinary layout, and the reason it survived is that only one half of the
    // branch had a test.
    const root = makeTree({
      ".env.local": ancestor,
      "package.json": manifest({ workspaces: ["apps/*"] }),
      "apps/web/package.json": manifest({ packageManager: "npm@10.0.0" }),
    });
    const app = join(root, "apps/web");
    const report = buildReport(app);
    expect(report.secretFiles.map((f) => f.path)).toContain(join(app, ".env.local"));
    expect(
      report.secretFiles.map((f) => f.path),
      "the ancestor must never be a destination for a secret we author",
    ).not.toContain(join(root, ".env.local"));
  });

  it("reuses a non-empty token inherited from the environment, and writes nothing", () => {
    // Inherited process.env beats every file. Calling that "another project's" generated a second
    // token into `.env.local` that neither loader would ever see — every request carrying it 401s.
    const root = makeTree({
      "package.json": manifest({ packageManager: "npm@10.0.0" }),
      ".gitignore": ".env.local\n",
    });
    initGit(root);
    const report = buildReport(root, { env: { FSD_DEMO_TOKEN: "from-the-shell" } });
    expect(report.secrets.FSD_DEMO_TOKEN.cli).toMatchObject({
      status: "non-empty",
      from: "the inherited environment",
      path: null,
    });
    expect(report.secretFiles.map((f) => f.path)).not.toContain(join(root, ".env.local"));
    expect(codes(report)).not.toContain("secret-file-tracked");
  });

  it("refuses an inherited empty token rather than pointing a write at a file neither loader will read", () => {
    // `FSD_DEMO_TOKEN=""` in the shell is set, so both loaders ignore `.env.local`. Generating
    // into that file leaves demo auth broken while the report stays green.
    const root = makeTree({
      "package.json": manifest({ packageManager: "npm@10.0.0" }),
      ".gitignore": ".env.local\n",
    });
    initGit(root);
    const report = buildReport(root, { env: { FSD_DEMO_TOKEN: "" } });
    expect(codes(report)).toContain("inherited-secret-empty");
    expect(report.refusals.find((r) => r.code === "inherited-secret-empty").message).toContain(
      "FSD_DEMO_TOKEN",
    );
  });

  it("refuses an inherited empty provider key the same way", () => {
    const root = makeTree({
      "package.json": manifest({ packageManager: "npm@10.0.0" }),
      ".gitignore": ".env.local\n",
    });
    initGit(root);
    const report = buildReport(root, { env: { [KEY]: "" }, providerKey: KEY });
    expect(codes(report)).toContain("inherited-secret-empty");
    expect(report.refusals.find((r) => r.code === "inherited-secret-empty").message).toContain(KEY);
  });

  it("writes a fresh token locally when one exists only in an ancestor", () => {
    // That token belongs to another app: next dev cannot see it, and a workspace-wide token means
    // one leak reaches every sibling.
    const root = makeTree({
      ".env.local": "FSD_DEMO_TOKEN=another-apps-token\n",
      "package.json": manifest({ workspaces: ["apps/*"] }),
      "apps/web/package.json": manifest({ packageManager: "npm@10.0.0" }),
    });
    const app = join(root, "apps/web");
    const report = buildReport(app);
    const own = report.secretFiles.find((f) => f.path === join(app, ".env.local"));
    expect(own, "the token's file must be the app's own").toBeDefined();
    expect(own.reasons.join(" ")).toContain("will be generated here");
    // And the ancestor is never named as a file we are about to write into.
    expect(report.secretFiles.map((f) => f.path)).not.toContain(join(root, ".env.local"));
  });
});
