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
