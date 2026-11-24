/**
 * `defineKit`: what the definer itself owns. A kit's factory checks its config
 * when the app calls it, so a bad config fails at the app's own line rather
 * than at start-up; ordering, slots and folders are the engine's and are
 * tested there (`packages/engine/test/flowstate/kits.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineKit, slot } from "../src";

const flows = () => ({ flows: [] });

describe("defineKit", () => {
  it("names each slot's key after the kit, so a contributor never spells it", () => {
    const board = defineKit({
      name: "board",
      slots: { columns: slot.list(z.string()), cards: slot.keyed(z.number()) },
      install: flows,
    });
    expect(board.kitName).toBe("board");
    expect(board.slots).toEqual({ columns: "board.columns", cards: "board.cards" });
  });

  it("refuses a kit name with a dot, which would make a slot key impossible to split", () => {
    expect(() => defineKit({ name: "my.kit", install: flows })).toThrow(/kit name "my\.kit"/);
    expect(() => defineKit({ name: "Board", install: flows })).toThrow(/kit name "Board"/);
  });

  it("checks the config when the app calls the factory, and hands the parsed value on", () => {
    const greeter = defineKit({
      name: "greeter",
      config: z.object({ greeting: z.string(), times: z.number().default(1) }),
      install: flows,
    });
    expect(greeter({ greeting: "hi" }).config).toEqual({ greeting: "hi", times: 1 });
    // A bad config is the app's mistake, so it fails at the app's own call.
    expect(() => greeter({ greeting: 3 } as never)).toThrow(/kit "greeter": its config is invalid: greeting:/);
  });

  it("refuses config for a kit that takes none, and a folder path for a kit that owns no folder", () => {
    const plain = defineKit({ name: "plain", install: flows });
    expect(() => plain({ model: "x" } as never)).toThrow(/kit "plain" takes no config, but was given "model"/);
    expect(() => plain({ directory: "./elsewhere" })).toThrow(/kit "plain": `directory` is set, but this kit owns no folder/);
  });

  it("keeps the app's folder path apart from the kit's own config", () => {
    const owner = defineKit({
      name: "owner",
      config: z.object({ model: z.string() }).strict(),
      directory: { path: "owner", read: () => undefined },
      install: flows,
    });
    const installed = owner({ model: "m", directory: "./mine" });
    // `.strict()` would refuse `directory` if it reached the schema.
    expect(installed.config).toEqual({ model: "m" });
    expect(installed.directory).toBe("./mine");
  });

  it("drops one slot's contribution on a copy, leaving the original as it was", () => {
    const owner = defineKit({ name: "owner", slots: { items: slot.list(z.string()) }, install: flows });
    const filler = defineKit({ name: "filler", requires: [owner], install: flows });
    const installed = filler();
    const dropped = installed.without(owner.slots.items);
    expect(dropped.withheld).toEqual([{ slot: "owner.items" }]);
    expect(installed.withheld).toEqual([]);
    // Or only one entry of it.
    expect(installed.without(owner.slots.items, "coder").withheld).toEqual([{ slot: "owner.items", key: "coder" }]);
  });
});
