/**
 * `runBy` and `canWrite` on a resource definition: who may write a user or org
 * resource from a client. The refusals here are the ones an app hits at start,
 * before any write: an org resource every member could write without anyone
 * choosing that (the owner's call, 2026-11-11), and shapes the default write
 * flow can't serve.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineResource } from "../src";

const pinsSchema = z.object({ pinned: z.array(z.string()).default([]) });

describe("runBy on a resource", () => {
  it("lets a user resource take the default write flow with no write rule: it is its owner's", () => {
    const pins = defineResource({ ref: "pins", scope: "user", stateSchema: pinsSchema, client: {}, runBy: "default" });
    expect(pins.runBy).toBe("default");
    expect(pins.canWrite).toBeUndefined();
  });

  it("refuses to define an org resource on the default write flow with no canWrite, naming it and the fix", () => {
    // Without the rule, every member of the org could write it, and nobody chose that.
    expect(() =>
      defineResource({ ref: "projects", scope: "org", stateSchema: pinsSchema, client: {}, runBy: "default" })
    ).toThrow(/org resource "projects".*canWrite.*canWrite: \(\) => true/s);
  });

  it("takes an org resource on the default write flow once it declares a rule, even everyone", () => {
    const everyone = defineResource({
      ref: "board",
      scope: "org",
      stateSchema: pinsSchema,
      client: {},
      runBy: "default",
      canWrite: () => true
    });
    expect(everyone.canWrite?.({ prev: { pinned: [] }, next: { pinned: [] }, userId: "u", orgId: "o" })).toBe(true);
  });

  it("leaves an org resource its own flow writes to that flow's rules", () => {
    const viaFlow = defineResource({ ref: "plan", scope: "org", stateSchema: pinsSchema, runBy: { flow: "planner" } });
    expect(viaFlow.runBy).toEqual({ flow: "planner" });
  });

  it("refuses runBy on a session resource: a session's resources are written in that session", () => {
    expect(() =>
      defineResource({ scope: "session", stateSchema: pinsSchema, client: {}, runBy: "default" } as never)
    ).toThrow(/runBy.*user or org/);
  });

  it("refuses the default write flow on a resource the client can't read", () => {
    // It writes only what the client can read; with no client config it reads nothing.
    expect(() => defineResource({ ref: "hidden", scope: "user", stateSchema: pinsSchema, runBy: "default" })).toThrow(
      /"hidden".*client/
    );
  });

  it("refuses the default write flow on a computed client projection", () => {
    expect(() =>
      defineResource({
        ref: "computed",
        scope: "user",
        stateSchema: pinsSchema,
        client: { data: (state) => ({ count: state.pinned.length }) },
        runBy: "default"
      })
    ).toThrow(/"computed".*client\.data/);
  });

  it("refuses runBy on a flow-isolated resource: a scope and key don't name it", () => {
    expect(() =>
      defineResource({ ref: "iso", scope: "user", stateSchema: pinsSchema, client: {}, flowIsolation: true, runBy: "default" })
    ).toThrow(/"iso".*flowIsolation/);
  });

  it("refuses canWrite without runBy: no flow would run it", () => {
    expect(() =>
      defineResource({ ref: "rule", scope: "user", stateSchema: pinsSchema, client: {}, canWrite: () => true })
    ).toThrow(/"rule".*canWrite.*runBy/);
  });
});
