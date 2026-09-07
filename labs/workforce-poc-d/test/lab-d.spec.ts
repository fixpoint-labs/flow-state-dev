/**
 * Lab D proof: yaml/json seats at load → today's AgentRegistry + defineFlow.
 *
 * These tests fail if a second registry appears, if L1 scanners suddenly
 * ingest the tree, or if a yaml written after boot becomes a live kind.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cpSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { discoverFlows } from "@flow-state-dev/fsdev";
import { readSkillsDirectory } from "@flow-state-dev/orchestration";
import { bootLab, loadCommittedTree, TREE_ROOT, until } from "../src/bootstrap";
import { loadSeatTree } from "../src/load";
import { createAgentRegistry } from "@flow-state-dev/workforce";

describe("lab D — data seats → defineFlow", () => {
  it("load/scan registers Agent + worker flow into the two registries that exist", async () => {
    const loaded = loadCommittedTree();
    expect(loaded.seats.map((s) => s.name).sort()).toEqual(["clerk", "intake"]);
    expect(loaded.skipped.some((s) => s.path.endsWith("roster.yaml"))).toBe(true);

    const host = await bootLab(loaded);
    try {
      const clerk = await host.agents.get("clerk");
      expect(clerk).toMatchObject({
        name: "clerk",
        description: "Staff the engineering desk and record what was said."
      });
      expect(typeof clerk?.persona).toBe("string");

      const intake = await host.agents.get("intake");
      expect(intake?.name).toBe("intake");

      const kinds = host.runtime.registry.list().map((f) => f.kind).sort();
      expect(kinds).toEqual(["clerk", "intake"]);
      expect(host.runtime.registry.get("clerk")?.actions.talk).toBeDefined();
      expect(host.runtime.registry.get("clerk")?.internal?.actions.receive).toBeDefined();

      // Same names, same two catalogs — not a Team registry, not an agents/ catalog.
      expect((await host.agents.list()).map((a) => a.name).sort()).toEqual(kinds);
    } finally {
      await host.dispose();
    }
  });

  it("L1 scanners do not ingest the seat tree — named gap, do not invent a parallel registry", async () => {
    const discovered = await discoverFlows({ cwd: TREE_ROOT, flowDirs: [TREE_ROOT] });
    expect(discovered).toEqual([]);

    const { skills, errors } = await readSkillsDirectory(join(TREE_ROOT, "teams"));
    expect(skills).toEqual([]);
    // engineering/ has no SKILL.md — walker either skips or records a miss.
    expect(errors.every((e) => /SKILL\.md/.test(e.error.message) || e.name === "engineering")).toBe(
      true
    );
  });

  it("seat can open a session and receive a dispatch", async () => {
    const host = await bootLab(loadCommittedTree());
    try {
      const dm = await host.createSession("clerk", "talk-to-clerk", "talk-to-clerk");
      expect(dm).toMatchObject({ id: "talk-to-clerk", flowKind: "clerk" });

      const who = await host.call("clerk", "whoami", {}, dm.id);
      expect(who.error).toBeUndefined();
      expect(who.output).toMatchObject({
        kind: "clerk",
        tools: ["board", "notes"],
        skills: ["file-note"]
      });

      const talked = await host.call("clerk", "talk", { message: "hello clerk" }, dm.id);
      expect(talked.error).toBeUndefined();
      expect(talked.output).toEqual({ sessionId: "talk-to-clerk", heard: "hello clerk" });

      const delivered = await host.call(
        "clerk",
        "deliver",
        { sessionId: dm.id, body: "standup in 10", fromSessionId: dm.id },
        dm.id
      );
      expect(delivered.error).toBeUndefined();

      await until(async () => {
        const state = await host.sessionState(dm.id);
        return state?.lastWake != null;
      }, "clerk lastWake");

      const state = await host.sessionState(dm.id);
      expect(state?.lastTalk).toBe("hello clerk");
      expect(state?.lastWake).toMatchObject({
        body: "standup in 10",
        fromSessionId: dm.id
      });
    } finally {
      await host.dispose();
    }
  });

  it("a seat yaml written after boot is not a live kind", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "workforce-poc-d-"));
    cpSync(TREE_ROOT, scratch, { recursive: true });

    const first = loadSeatTree(scratch);
    const host = await bootLab(first);
    try {
      mkdirSync(join(scratch, "teams", "engineering", "workers"), { recursive: true });
      writeFileSync(
        join(scratch, "teams", "engineering", "workers", "late.yaml"),
        ["name: late", "description: Arrived after boot.", "persona: Too late."].join("\n")
      );

      const rescanned = loadSeatTree(scratch);
      expect(rescanned.seats.map((s) => s.name)).toContain("late");

      expect(host.runtime.registry.get("late")).toBeUndefined();
      expect(await host.agents.get("late")).toBeUndefined();
      expect(host.runtime.registry.list().map((f) => f.kind).sort()).toEqual(["clerk", "intake"]);

      // Rebuilding AgentRegistry from a later scan is a new object — the boot
      // host still holds the boot-time one. That is the "no hot-dynamic kinds" lock.
      const laterRegistry = createAgentRegistry(rescanned.agents);
      expect(await laterRegistry.get("late")).toBeDefined();
      expect(laterRegistry).not.toBe(host.agents);
    } finally {
      await host.dispose();
    }
  });
});
