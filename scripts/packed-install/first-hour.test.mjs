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
  installedOutsideTarballs,
  mapInstallLines,
  quickstartPlan,
  readerEnv,
  rewriteExampleManifest,
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
    ["@flow-state-dev/core", "/t/core.tgz"],
    ["@flow-state-dev/fsdev", "/t/fsdev.tgz"],
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
    ["@flow-state-dev/core", "/t/core.tgz"],
    ["@flow-state-dev/contracts", "/t/contracts.tgz"],
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
    const versions = new Map(["core", "engine", "client"].map((n) => [`@flow-state-dev/${n}`, { version: "1.0.0" }]));
    const violations = installedOutsideTarballs(dir, versions).sort();
    assert.equal(violations.length, 3);
    assert.match(violations[0], /client resolves to .*repo-client, outside the folder/);
    assert.match(violations[1], /engine installed 0\.9\.0, the tarball is 1\.0\.0/);
    assert.match(violations[2], /stray@1\.0\.0 is installed and is not one of the tarballs/);
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

test("the stub model answers a streamed Responses call and refuses what it does not serve", async () => {
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
  } finally {
    server.close();
  }
});
