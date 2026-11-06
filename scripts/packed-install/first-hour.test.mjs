/**
 * The First hour leg's rules (first-hour.mjs), pinned on small inputs: which
 * blocks of the quick start become steps, how install lines and example
 * manifests map to tarballs, what the reader's environment keeps out, and
 * what the resolution guard refuses. Each is here because getting it wrong
 * lets the leg run something other than what the reader runs, or run the
 * repository's code and call it the install.
 *
 * Run: `node --test scripts/packed-install/first-hour.test.mjs`.
 */
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handle, STUB_ANSWER } from "./fixtures/stub-model.mjs";
import {
  assertFsdevFromFolder,
  exampleRun,
  installedOutsideTarballs,
  mapInstallLines,
  quickstartPlan,
  readerEnv,
  rewriteExampleManifest,
  runQuickstart,
} from "./first-hour.mjs";

const page = [
  "# Quick Start",
  "```bash",
  "pnpm add @flow-state-dev/core zod",
  "```",
  "```ts title=\"src/flow.ts\"",
  "export const x = 1;",
  "```",
  "```ts",
  "// an untitled snippet: prose, not a step",
  "```",
  "```bash",
  "# only a comment",
  "```",
  "```bash",
  "pnpm dev",
  "```",
  "```bash",
  "fsdev run hello-chat chat -i '{}'",
  "```",
].join("\n");

test("titled blocks become files and shell blocks run, in page order; untitled snippets, comment-only blocks and pnpm dev do not", () => {
  const steps = quickstartPlan(page);
  assert.deepEqual(
    steps.map((s) => (s.kind === "file" ? `file ${s.path}` : `shell ${s.script}`)),
    ["shell pnpm add @flow-state-dev/core zod", "file src/flow.ts", "shell fsdev run hello-chat chat -i '{}'"],
  );
  assert.equal(steps[1].content, "export const x = 1;\n");
});

test("pnpm dev is skipped only as a whole line, so a command that merely mentions dev still runs", () => {
  const [step] = quickstartPlan("```bash\npnpm dev\npnpm add -D @flow-state-dev/fsdev\n```");
  assert.equal(step.script, "pnpm add -D @flow-state-dev/fsdev");
});

test("install lines map every @flow-state-dev name, with or without a range, to its tarball; other lines and other packages are untouched", () => {
  const tarballs = new Map([
    ["@flow-state-dev/core", { tarball: "/t/core.tgz", version: "1.0.0" }],
    ["@flow-state-dev/fsdev", { tarball: "/t/fsdev.tgz", version: "1.0.0" }],
  ]);
  const { script, unknown } = mapInstallLines(
    "pnpm add @flow-state-dev/core@^0.4 zod\npnpm add -D @flow-state-dev/fsdev # the CLI\necho @flow-state-dev/core",
    tarballs,
  );
  assert.equal(script, "pnpm add '/t/core.tgz' zod\npnpm add -D '/t/fsdev.tgz'\necho @flow-state-dev/core");
  assert.deepEqual(unknown, []);
});

test("an install line naming a package with no tarball is reported, not sent to the registry silently", () => {
  const { unknown } = mapInstallLines("npm install @flow-state-dev/nope", new Map());
  assert.deepEqual(unknown, ["@flow-state-dev/nope"]);
});

test("an example's workspace ranges become tarballs, other ranges stay, and every tarball is an override for transitive copies", () => {
  const tarballs = new Map([
    ["@flow-state-dev/core", { tarball: "/t/core.tgz", version: "1.0.0" }],
    ["@flow-state-dev/contracts", { tarball: "/t/contracts.tgz", version: "1.0.0" }],
  ]);
  const { manifest, unknown } = rewriteExampleManifest(
    { dependencies: { "@flow-state-dev/core": "workspace:*", zod: "^3" }, devDependencies: { "@flow-state-dev/gone": "workspace:^" } },
    tarballs,
  );
  assert.deepEqual(manifest.dependencies, { "@flow-state-dev/core": "file:/t/core.tgz", zod: "^3" });
  assert.deepEqual(manifest.overrides, { "@flow-state-dev/core": "file:/t/core.tgz", "@flow-state-dev/contracts": "file:/t/contracts.tgz" });
  assert.deepEqual(unknown, ["@flow-state-dev/gone"]);
});

test("the reader's environment has no real model key, no repository bin on PATH, and the stub when asked", () => {
  const env = readerEnv(
    { PATH: "/repo/node_modules/.bin:/usr/bin:/repo/packages/x/node_modules/.bin", ANTHROPIC_API_KEY: "real", OPENAI_API_KEY: "real", FSDEV_DEFAULT_MODEL: "vercel:x", npm_package_name: "x" },
    "/repo",
    "http://127.0.0.1:1/v1",
  );
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.npm_package_name, undefined);
  assert.equal(env.FSDEV_DEFAULT_MODEL, undefined);
  assert.equal(env.OPENAI_BASE_URL, "http://127.0.0.1:1/v1");
  assert.notEqual(env.OPENAI_API_KEY, "real");
  assert.equal(readerEnv({ OPENAI_API_KEY: "real" }, "/repo", null).OPENAI_API_KEY, undefined);
});

test("the resolution guard refuses a @flow-state-dev package linked outside the folder, a wrong version, and one that is not a tarball", () => {
  const root = mkdtempSync(join(tmpdir(), "fsd-first-hour-guard-"));
  try {
    const dir = join(root, "app");
    const scope = join(dir, "node_modules", "@flow-state-dev");
    mkdirSync(scope, { recursive: true });
    const pkg = (at, version) => {
      mkdirSync(at, { recursive: true });
      writeFileSync(join(at, "package.json"), JSON.stringify({ version }));
    };
    pkg(join(scope, "core"), "1.0.0");
    pkg(join(scope, "engine"), "0.9.0");
    pkg(join(scope, "stray"), "1.0.0");
    pkg(join(root, "repo-client"), "1.0.0");
    symlinkSync(join(root, "repo-client"), join(scope, "client"), "dir");
    const tarballs = new Map(["core", "engine", "client"].map((n) => [`@flow-state-dev/${n}`, { tarball: `/t/${n}.tgz`, version: "1.0.0" }]));
    const violations = installedOutsideTarballs(dir, tarballs).sort();
    assert.equal(violations.length, 3);
    assert.match(violations[0], /client .*resolves to .*repo-client, outside the folder/);
    assert.match(violations[1], /engine .*installed 0\.9\.0, the tarball is 1\.0\.0/);
    assert.match(violations[2], /stray@1\.0\.0 .*is installed and is not one of the tarballs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the resolution guard follows each package's own @flow-state-dev dependencies, so a copy nested under another is checked too", () => {
  const root = mkdtempSync(join(tmpdir(), "fsd-first-hour-nested-"));
  try {
    const dir = join(root, "app");
    const pkg = (at, manifest) => {
      mkdirSync(at, { recursive: true });
      writeFileSync(join(at, "package.json"), JSON.stringify(manifest));
    };
    pkg(dir, { dependencies: { "@flow-state-dev/core": "file:/t/core.tgz" } });
    const core = join(dir, "node_modules", "@flow-state-dev", "core");
    pkg(core, { name: "@flow-state-dev/core", version: "1.0.0", dependencies: { "@flow-state-dev/engine": "1.0.0" } });
    // core's own engine, one level down, linking to a workspace package at another version.
    pkg(join(root, "repo-engine"), { name: "@flow-state-dev/engine", version: "0.0.0-workspace" });
    mkdirSync(join(core, "node_modules", "@flow-state-dev"), { recursive: true });
    symlinkSync(join(root, "repo-engine"), join(core, "node_modules", "@flow-state-dev", "engine"), "dir");
    const tarballs = new Map(["core", "engine"].map((n) => [`@flow-state-dev/${n}`, { tarball: `/t/${n}.tgz`, version: "1.0.0" }]));
    const violations = installedOutsideTarballs(dir, tarballs);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /@flow-state-dev\/engine \(from @flow-state-dev\/core\) resolves to .*repo-engine, outside the folder/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a bare fsdev on PATH that lives outside the folder is refused; the folder's own, or none at all, is not", () => {
  const root = mkdtempSync(join(tmpdir(), "fsd-first-hour-bin-"));
  try {
    const dir = join(root, "app");
    const bin = (at) => {
      mkdirSync(at, { recursive: true });
      writeFileSync(join(at, "fsdev"), "#!/bin/sh\n");
      chmodSync(join(at, "fsdev"), 0o755);
      return at;
    };
    const outside = bin(join(root, "linked-workspace-bin"));
    const inside = bin(join(dir, "node_modules", ".bin"));
    assert.throws(() => assertFsdevFromFolder(dir, { PATH: `${outside}:/usr/bin:/bin` }), /fsdev on PATH .* outside the folder/);
    assert.doesNotThrow(() => assertFsdevFromFolder(dir, { PATH: `${inside}:/usr/bin:/bin` }));
    assert.doesNotThrow(() => assertFsdevFromFolder(dir, { PATH: "/usr/bin:/bin" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the stub model answers Responses and Chat Completions, streamed and not, and refuses what it does not serve", async () => {
  const server = createServer((req, res) => handle(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const post = (path, body) =>
    new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: server.address().port, path, method: "POST" }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, text }));
      });
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
  try {
    const streamed = await post("/v1/responses", { model: "m", stream: true });
    assert.equal(streamed.status, 200);
    assert.ok(streamed.text.includes(STUB_ANSWER));
    assert.ok(streamed.text.includes("response.completed"));
    assert.equal((await post("/v1/embeddings", {})).status, 404);

    const responses = await post("/v1/responses", { model: "m" });
    assert.equal(responses.status, 200);
    const body = JSON.parse(responses.text);
    assert.equal(body.status, "completed");
    assert.equal(body.output[0].content[0].text, STUB_ANSWER);

    const chat = await post("/v1/chat/completions", { model: "m" });
    assert.equal(chat.status, 200);
    const completion = JSON.parse(chat.text);
    assert.equal(completion.choices[0].message.content, STUB_ANSWER);
    assert.equal(completion.choices[0].finish_reason, "stop");

    const chatStreamed = await post("/v1/chat/completions", { model: "m", stream: true });
    assert.equal(chatStreamed.status, 200);
    const chunks = chatStreamed.text
      .split("\n\n")
      .filter((e) => e.startsWith("data: ") && e !== "data: [DONE]")
      .map((e) => JSON.parse(e.slice("data: ".length)));
    assert.equal(chunks.map((c) => c.choices[0].delta.content ?? "").join(""), STUB_ANSWER);
    assert.equal(chunks.at(-1).choices[0].finish_reason, "stop");
    assert.ok(chatStreamed.text.trimEnd().endsWith("data: [DONE]"));
  } finally {
    server.close();
  }
});

/**
 * A run that could not happen is `error`, never an expected `fail`: under the
 * control every admitted cell must fail, so a registry outage or a hung step
 * that read as `fail` would pass the control without running one assertion.
 * These drive the real runners with a fake package manager first on `PATH`,
 * and read the outcome the way `runChecks` does (a throw is `error`).
 */
const outcomeOf = (fn) => {
  try {
    return fn().length === 0 ? "pass" : "fail";
  } catch {
    return "error";
  }
};

function withFakeBin(name, script, fn) {
  const root = mkdtempSync(join(tmpdir(), "fsd-first-hour-infra-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`);
  chmodSync(join(bin, name), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved}`;
  try {
    return fn(root);
  } finally {
    process.env.PATH = saved;
    rmSync(root, { recursive: true, force: true });
  }
}

function copyOut(root, timeout) {
  const src = join(root, "src");
  mkdirSync(src);
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "ex", private: true, scripts: { typecheck: "true" } }));
  mkdirSync(join(root, "out", "ex"), { recursive: true });
  return exampleRun({ src, dir: join(root, "out", "ex"), repoRoot: "/nonexistent-repo", tarballs: new Map(), timeout });
}

test("an example install that times out is an error, and so is every step that waits on it", () => {
  withFakeBin("npm", "sleep 5; exit 1", (root) => {
    const run = copyOut(root, 300);
    assert.equal(outcomeOf(() => run.step("install")), "error");
    assert.equal(outcomeOf(() => run.step("typecheck")), "error");
  });
});

test("an example install the registry or network broke is an error, and so is every step that waits on it", () => {
  const network = 'echo "npm error code ECONNRESET" >&2\necho "npm error network aborted" >&2\nexit 1';
  withFakeBin("npm", network, (root) => {
    const run = copyOut(root);
    assert.equal(outcomeOf(() => run.step("install")), "error");
    assert.equal(outcomeOf(() => run.step("typecheck")), "error");
  });
});

test("an example install that fails on what the tarballs ask for stays a fail", () => {
  const notarget = 'echo "npm error code ETARGET" >&2\necho "npm error notarget No matching version found for @flow-state-dev/x@9.9.9." >&2\nexit 1';
  withFakeBin("npm", notarget, (root) => {
    const run = copyOut(root);
    assert.equal(outcomeOf(() => run.step("install")), "fail");
    assert.equal(outcomeOf(() => run.step("typecheck")), "fail");
  });
});

const quickstartPage = "```bash\npnpm add zod\n```\n```bash\nfsdev run hello-chat chat -i '{}'\n```\n";

function quickstart(root, timeout) {
  mkdirSync(join(root, "app"));
  return runQuickstart({ markdown: quickstartPage, dir: join(root, "app"), repoRoot: "/nonexistent-repo", tarballs: new Map(), timeout });
}

test("a quick start install block the registry or network broke is an error", () => {
  const fetchFail =
    'echo " ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/zod: request to https://registry.npmjs.org/zod failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org" >&2\nexit 1';
  withFakeBin("pnpm", fetchFail, (root) => assert.equal(outcomeOf(() => quickstart(root)), "error"));
});

test("a quick start block that times out is an error", () => {
  withFakeBin("pnpm", "sleep 5; exit 1", (root) => assert.equal(outcomeOf(() => quickstart(root, 300)), "error"));
});

test("a quick start install block that fails on what the tarballs ask for stays a fail", () => {
  const noMatch = 'echo " ERR_PNPM_NO_MATCHING_VERSION  No matching version found for zod@99" >&2\nexit 1';
  withFakeBin("pnpm", noMatch, (root) => assert.equal(outcomeOf(() => quickstart(root)), "fail"));
});

test("a quick start block that runs a stray fsdev anywhere in a line, not only at its start, is an error", () => {
  const page = "```bash\necho setup; fsdev run hello-chat chat -i '{}'\n```\n";
  withFakeBin("fsdev", "exit 1", (root) => {
    mkdirSync(join(root, "app"));
    const run = () => runQuickstart({ markdown: page, dir: join(root, "app"), repoRoot: "/nonexistent-repo", tarballs: new Map() });
    assert.equal(outcomeOf(run), "error");
  });
});
