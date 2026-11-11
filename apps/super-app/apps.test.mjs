/**
 * What `apps.mjs` states about the apps it hosts that lives in another
 * package, and so can drift from it without anything failing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { APPS, REPO } from "./apps.mjs";

describe("Kitchen Sink's DevTool user", () => {
  it("is the user Kitchen Sink runs every caller as", () => {
    // The DevTool opens Kitchen Sink as this user; one that isn't Kitchen Sink's own sees no sessions.
    const source = readFileSync(join(REPO, "apps/kitchen-sink/lib/kitchen-sink-principal.ts"), "utf8");
    const declared = /export const KITCHEN_SINK_USER_ID\s*=\s*"([^"]+)"/.exec(source);
    assert.notEqual(declared, null, "KITCHEN_SINK_USER_ID is no longer a string constant in kitchen-sink-principal.ts: update this test");
    assert.equal(APPS.find((a) => a.id === "kitchen-sink")?.devtoolUserId, declared?.[1]);
  });
});

describe("pnpm dev's page builds", () => {
  it("never keep a bundler running between builds", () => {
    // `vite build --watch` holds about 1.5GB per page and grows with each rebuild until
    // V8's heap limit ends it. Pages rebuild through `rebuildOnChange` (rebuild.mjs) instead.
    for (const app of APPS) {
      for (const step of app.run.dev) {
        assert.ok(!step.args.includes("--watch") && !step.args.includes("-w"), `${app.id}: ${step.args.join(" ")} runs a watching build`);
      }
    }
    const run = readFileSync(join(REPO, "apps/super-app/run.mjs"), "utf8");
    assert.doesNotMatch(run, /build:devtool", "--watch"/, "the DevTool page runs a watching build");
  });

  it("rebuild each page from a build that records its inputs", () => {
    // A rebuild only follows files the last build recorded; a page whose Vite config doesn't record them never rebuilds.
    for (const app of APPS) {
      for (const step of app.run.dev.filter((s) => s.rebuildOnChange !== undefined)) {
        const config = readFileSync(join(step.cwd, "vite.config.ts"), "utf8");
        assert.match(config, /recordBuildInputs\(/, `${app.id}'s vite.config.ts doesn't record its build inputs`);
      }
    }
    assert.match(readFileSync(join(REPO, "apps/super-app/vite.config.ts"), "utf8"), /recordBuildInputs\(/);
  });
});

describe("pnpm dev's lab servers", () => {
  it("record what they load, so a change to it can be offered as a restart; Kitchen Sink's doesn't need to", () => {
    for (const app of APPS) {
      const server = app.run.dev.filter((s) => !s.background).at(-1);
      if (app.kind === "next") {
        assert.equal(server.serverInputs, undefined, `${app.id}: next dev reloads itself`);
        continue;
      }
      assert.ok(server.serverInputs !== undefined, `${app.id}'s server step records nothing, so it is never marked changed`);
      assert.equal(server.args[0], "--import", `${app.id}: the recording preload must be tsx's first argument`);
      assert.equal(server.env?.SUPER_APP_SERVER_INPUTS, server.serverInputs);
    }
  });
});
