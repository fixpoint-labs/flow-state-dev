/**
 * A setting a worker flow retired (`retiredSettings`, BP-030): a worker stored
 * while the flow still took it reads without it, and runs; a hire or an edit
 * that names it is refused, by name, with nothing written. FIX-2877 D3 retires
 * Teammates' per-teammate `harness` this way.
 *
 * The stored worker is written by a host whose flow still takes the setting,
 * then read by one on the same stores whose flow has retired it.
 */
import { describe, expect, it } from "vitest";
import { inMemoryStores } from "@flow-state-dev/engine";
import { mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import { bootBoardHost, messageOf } from "./conversation-board-harness";

const LOOKS = { icon: z.string().optional() };

/** A host over `stores`; `retired` is the agent flow before (`false`) or after (`true`) it retired `harness`. */
const host = (stores: ReturnType<typeof inMemoryStores>, retired: boolean) =>
  bootBoardHost({
    stores,
    agent: { settings: retired ? LOOKS : { ...LOOKS, harness: z.string().optional() } } as never,
    registration: { agent: retired ? { showSettings: ["icon"], retiredSettings: ["harness"] } : { showSettings: ["icon", "harness"] } },
    agentAnswer: mockGenerator({ name: "agent-answer", script: [{ when: () => true, then: { text: "On it." } }] })
  });

/** A user's worker, hired with a harness before the flow retired it. */
async function storedBeforeRetirement() {
  const stores = inMemoryStores();
  const before = host(stores, false);
  try {
    const hired = await before.hire("alice", { id: "scout", description: "Looks around.", settings: { icon: "🔎", harness: "codex" } });
    expect(hired.error, messageOf(hired.error)).toBeUndefined();
    expect((await before.client("alice").roster()).find((row) => row.id === "scout")?.settings).toEqual({ icon: "🔎", harness: "codex" });
  } finally {
    await before.dispose();
  }
  return stores;
}

describe("a setting the agent flow retired", () => {
  it("a worker stored with it still runs, and its roster row has none", async () => {
    const after = host(await storedBeforeRetirement(), true);
    try {
      expect((await after.client("alice").roster()).find((row) => row.id === "scout")?.settings).toEqual({ icon: "🔎" });
      const conv = await after.create("alice", "agent", { state: { workerId: "scout" } });
      expect(conv.status, JSON.stringify(conv.body)).toBeLessThan(300);
      const turn = await after.act("alice", conv.body.session!.id, "respond", { message: "hello" }, "agent");
      expect(turn.error, messageOf(turn.error)).toBeUndefined();
    } finally {
      await after.dispose();
    }
  });

  it("an edit of that worker keeps it running and drops the setting from what is stored", async () => {
    const stores = await storedBeforeRetirement();
    const after = host(stores, true);
    try {
      const edited = await after.act("alice", "roster-alice", "edit", { id: "scout", settingsPatch: { icon: "🧭" } }, "roster");
      expect(edited.error, messageOf(edited.error)).toBeUndefined();
    } finally {
      await after.dispose();
    }
    // Read by a host that still takes it: the stored row no longer carries it.
    const before = host(stores, false);
    try {
      expect((await before.client("alice").roster()).find((row) => row.id === "scout")?.settings).toEqual({ icon: "🧭" });
    } finally {
      await before.dispose();
    }
  });

  it("a hire or an edit naming it is refused by name, and nothing is written", async () => {
    const after = host(await storedBeforeRetirement(), true);
    try {
      const hired = await after.hire("alice", { id: "scribe", description: "Writes.", settings: { harness: "cursor" } });
      expect(messageOf(hired.error)).toContain('Worker "scribe" sets "harness", which flow "agent" no longer takes. Leave it out. Nothing was written.');
      const edited = await after.act("alice", "roster-alice", "edit", { id: "scout", settingsPatch: { harness: "cursor" } }, "roster");
      expect(messageOf(edited.error)).toContain('Worker "scout" sets "harness", which flow "agent" no longer takes.');
      expect((await after.client("alice").roster()).map((row) => row.id)).not.toContain("scribe");
    } finally {
      await after.dispose();
    }
  });
});
