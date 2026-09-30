import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_ROOT,
  formatWalk,
  proposedHost,
  walkConvention,
} from "../src/index";

const KIND_FILES = [
  "workers/night-watch/kind.md",
  "workers/reviewer/kind.md",
  "workers/triage/kind.md",
];

describe("wake-convention tree", () => {
  it("registers transports and events by folder, not a host TypeScript map", async () => {
    const walk = await walkConvention();
    const ids = walk.transports.map((transport) => transport.id).sort();
    expect(ids).toEqual(["github", "scheduled", "slack"]);
    expect(walk.catalog.map((event) => event.id).sort()).toEqual([
      "github.issues.opened",
      "github.pull_request.review_requested",
      "scheduled.tick",
      "slack.message.posted",
    ]);
    expect(walk.transports.find((t) => t.id === "github")?.source).toBe(
      "webhook",
    );
    expect(walk.transports.find((t) => t.id === "scheduled")?.source).toBe(
      "scheduled",
    );
  });

  it("keeps cron on the night-watch folder, not on a flow map", async () => {
    const walk = await walkConvention();
    const nightWatch = walk.seats.find((seat) => seat.id === "night-watch");
    expect(nightWatch?.kind).toBe("worker");
    expect(nightWatch?.wake).toBe("every 4 hours");
    expect(nightWatch?.schedule).toEqual({
      every: "4 hours",
      cron: undefined,
      run: "sweep",
      session: "new",
    });
    expect(nightWatch?.hooks.some((h) => h.event === "github.issues.opened")).toBe(
      true,
    );
  });

  it("lets a worker reference a registered event, and leftovers stay leftovers", async () => {
    const walk = await walkConvention();
    const reviewer = walk.seats.find((seat) => seat.id === "reviewer");
    expect(reviewer?.hooks.map((h) => h.event)).toEqual([
      "github.pull_request.review_requested",
      "github.issues.closed",
    ]);
    expect(walk.leftovers.map((row) => `${row.seat}:${row.ref}`).sort()).toEqual([
      "night-watch:channel.support-desk.poke",
      "reviewer:github.issues.closed",
      "support-desk:poke",
    ]);
    expect(
      walk.leftovers.find((row) => row.ref === "github.issues.closed")?.reason,
    ).toBe("not in the transport event catalog");
  });

  it("does not put schedules or webhooks on the kind files", async () => {
    for (const rel of KIND_FILES) {
      const text = await readFile(path.join(EXAMPLE_ROOT, rel), "utf8");
      expect(text).not.toMatch(/\bschedules\s*:/);
      expect(text).not.toMatch(/\bwebhooks\s*:/);
    }
  });

  it("does not invent a compile target or a second dispatch door", async () => {
    const walk = await walkConvention();
    const printed = formatWalk(walk);
    expect(printed).toContain("github.issues.opened");
    expect(printed).toContain("wake: every 4 hours");
    expect(printed).not.toContain("defineScheduleBinding");
    expect(printed).not.toContain("defineWebhookBinding");
    expect(printed).not.toContain("NotificationFlow");
    expect(printed).not.toContain("Heartbeats");
    expect(proposedHost.dispatchDoor).toContain("host.dispatch");
    expect(proposedHost.hop).toContain("dispatcher(");
    expect(proposedHost.rejectedSeatModule).toBe(
      "webhooks.ts imported as config",
    );
  });

  it("leaves triage without a clock or hook — hops are delivery, not a wake", async () => {
    const walk = await walkConvention();
    const triage = walk.seats.find((seat) => seat.id === "triage");
    expect(triage?.wake).toBeUndefined();
    expect(triage?.schedule).toBeUndefined();
    expect(triage?.hooks).toEqual([]);
  });
});
