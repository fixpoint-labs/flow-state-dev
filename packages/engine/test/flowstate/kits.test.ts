/**
 * `createFlowState({ kits })`: an app lists kits in any order, and the engine
 * installs them in `requires` order, fills each slot once, reads each kit's
 * folder through the claim pass and registers the flows each install returns.
 *
 * What is wrong with the list (an order nobody can satisfy, a slot filled
 * badly) throws at construction, as a duplicate flow id does. What is wrong
 * with a folder is found at start-up, and rejects `ready()` and every request.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineKit, slot, type KitFolder } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, type FlowState } from "../../src";

const states: FlowState[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const stores = { dev: { primary: inMemoryStores() } };
const flowOf = (kind: string) => defineFlow({ kind, actions: {} })();

function track(state: FlowState): FlowState {
  states.push(state);
  return state;
}

function tempDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "fsd-kits-"));
  dirs.push(dir);
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), body);
  }
  return dir;
}

/** Kits b ← c ← d: b declares a keyed and a list slot; c and d fill them. */
function chain() {
  const seen: { installs: string[]; entries?: Readonly<Record<string, string>>; order?: readonly string[] } = {
    installs: [],
  };
  const b = defineKit({
    name: "b",
    slots: { entries: slot.keyed(z.string()), order: slot.list(z.string()) },
    install: ({ slots }) => {
      seen.installs.push("b");
      seen.entries = slots.entries;
      seen.order = slots.order;
      return { flows: [flowOf("b-flow")] };
    },
  });
  const c = defineKit({
    name: "c",
    requires: [b],
    contributes: () => ({ [b.slots.entries]: { c: "from c" }, [b.slots.order]: "c" }),
    install: () => {
      seen.installs.push("c");
      return { flows: [flowOf("c-flow")] };
    },
  });
  const d = defineKit({
    name: "d",
    requires: [c],
    // `d` requires `b` only through `c`, which is enough to fill its slots.
    contributes: () => ({ [b.slots.entries]: { d: "from d" }, [b.slots.order]: ["d"] }),
    install: () => {
      seen.installs.push("d");
      return { flows: [flowOf("d-flow")] };
    },
  });
  return { b, c, d, seen };
}

describe("installing kits", () => {
  it("installs in requires order whatever order the app lists, and fills each slot from its dependents", async () => {
    const { b, c, d, seen } = chain();
    const state = track(createFlowState({ kits: [d(), b(), c()], stores }));
    await state.ready();

    expect(seen.installs).toEqual(["b", "c", "d"]);
    expect(seen.entries).toEqual({ c: "from c", d: "from d" });
    expect(seen.order).toEqual(["c", "d"]);
    expect([...state.meta.flowKeys].sort()).toEqual(["b-flow", "c-flow", "d-flow"]);
  });

  it("serves the app's own flows beside the kits', and appends the app's list entries last", async () => {
    const { b, c, seen } = chain();
    const state = track(
      createFlowState({
        kits: [c(), b()],
        flows: [flowOf("app-flow")],
        fill: { [b.slots.order]: ["app"], [b.slots.entries]: { app: "from the app" } },
        stores,
      }),
    );
    await state.ready();
    expect(seen.order).toEqual(["c", "app"]);
    expect(seen.entries).toEqual({ c: "from c", app: "from the app" });
    expect([...state.meta.flowKeys].sort()).toEqual(["app-flow", "b-flow", "c-flow"]);
  });

  it("registers a kit's flows at start-up, not at construction", async () => {
    const { b } = chain();
    const state = track(createFlowState({ kits: [b()], stores }));
    expect(state.meta.flowKeys).toEqual([]);
    await state.ready();
    expect(state.meta.flowKeys).toEqual(["b-flow"]);
  });

  it("runs a kit's contribution after its dependents', so it can pass on what they filled", async () => {
    // b ← c ← d, where c declares its own slot that d fills, and c's entry in
    // b is built from it. Dependents contribute first.
    let entries: Readonly<Record<string, string>> | undefined;
    const b = defineKit({
      name: "b",
      slots: { entries: slot.keyed(z.string()) },
      install: ({ slots }) => {
        entries = slots.entries;
        return { flows: [] };
      },
    });
    const c = defineKit({
      name: "c",
      requires: [b],
      slots: { extras: slot.list(z.string()) },
      contributes: ({ slots }) => ({ [b.slots.entries]: { c: `c with ${slots.extras.join("+")}` } }),
      install: () => ({ flows: [] }),
    });
    const d = defineKit({
      name: "d",
      requires: [c],
      contributes: () => ({ [c.slots.extras]: ["from d"] }),
      install: () => ({ flows: [] }),
    });
    const state = track(createFlowState({ kits: [b(), c(), d()], fill: { [c.slots.extras]: ["from the app"] }, stores }));
    await state.ready();
    expect(entries).toEqual({ c: "c with from d+from the app" });
  });

  it("keys an entry by its id when a keyed slot is given entries rather than a record", async () => {
    let harnesses: Readonly<Record<string, { id: string; agent: string }>> | undefined;
    const owner = defineKit({
      name: "owner",
      slots: { harnesses: slot.keyed(z.object({ id: z.string(), agent: z.string() })) },
      install: ({ slots }) => {
        harnesses = slots.harnesses;
        return { flows: [] };
      },
    });
    const state = track(
      createFlowState({
        kits: [owner()],
        fill: { [owner.slots.harnesses]: [{ id: "codex", agent: "Codex" }, { id: "cursor", agent: "Cursor" }] },
        stores,
      }),
    );
    await state.ready();
    expect(harnesses).toEqual({ codex: { id: "codex", agent: "Codex" }, cursor: { id: "cursor", agent: "Cursor" } });
    // An entry with no id can't be keyed, and says so.
    expect(() => createFlowState({ kits: [owner()], fill: { [owner.slots.harnesses]: [{ agent: "x" }] }, stores })).toThrow(
      /slot "owner\.harnesses" is keyed, but the app gave it an entry with no string `id`/,
    );
  });

  it("drops one entry of a kit's contribution, keeping the rest", async () => {
    const { b, c, d, seen } = chain();
    const state = track(createFlowState({ kits: [b(), c(), d().without(b.slots.entries, "d")], stores }));
    await state.ready();
    expect(seen.entries).toEqual({ c: "from c" });
    expect(seen.order).toEqual(["c", "d"]);
  });

  it("hands each slot what its schema parsed: defaults applied, values coerced", async () => {
    let seen: { list?: readonly { n: number }[]; keyed?: Readonly<Record<string, number>> } = {};
    const owner = defineKit({
      name: "owner",
      slots: { list: slot.list(z.object({ n: z.number().default(1) })), keyed: slot.keyed(z.coerce.number()) },
      install: ({ slots }) => {
        seen = { list: slots.list, keyed: slots.keyed };
        return { flows: [] };
      },
    });
    const state = track(
      createFlowState({ kits: [owner()], fill: { [owner.slots.list]: [{}], [owner.slots.keyed]: { three: "3" } }, stores }),
    );
    await state.ready();
    expect(seen.list).toEqual([{ n: 1 }]);
    expect(seen.keyed).toEqual({ three: 3 });
  });

  it("drops one kit's contribution when the app asks", async () => {
    const { b, c, d, seen } = chain();
    const state = track(createFlowState({ kits: [b(), c(), d().without(b.slots.order)], stores }));
    await state.ready();
    expect(seen.order).toEqual(["c"]);
    expect(seen.entries).toEqual({ c: "from c", d: "from d" });
  });
});

describe("refused at construction", () => {
  it("refuses a keyed entry two kits give, naming both", () => {
    const { b, c } = chain();
    const twin = defineKit({
      name: "twin",
      requires: [c],
      contributes: () => ({ [b.slots.entries]: { c: "again" } }),
      install: () => ({ flows: [] }),
    });
    expect(() => createFlowState({ kits: [twin(), c(), b()], stores })).toThrow(
      /slot "b\.entries": the key "c" is filled by kit "c" and by kit "twin"/,
    );
  });

  it("refuses a fill by a kit that does not require the slot's owner, naming both", () => {
    const { b } = chain();
    const stranger = defineKit({
      name: "stranger",
      contributes: () => ({ [b.slots.order]: "x" }),
      install: () => ({ flows: [] }),
    });
    expect(() => createFlowState({ kits: [b(), stranger()], stores })).toThrow(
      /kit "stranger" fills slot "b\.order", but does not require kit "b"/,
    );
  });

  it("names every problem with the slots at once", () => {
    const { b } = chain();
    const stranger = defineKit({
      name: "stranger",
      contributes: () => ({ [b.slots.order]: "x", "nobody.here": 1 }),
      install: () => ({ flows: [] }),
    });
    let message = "";
    try {
      createFlowState({ kits: [b(), stranger()], stores });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/does not require kit "b"/);
    expect(message).toMatch(/slot "nobody\.here", which no installed kit declares/);
  });

  it("refuses an entry its slot's schema refuses", () => {
    const { b } = chain();
    const wrong = defineKit({
      name: "wrong",
      requires: [b],
      contributes: () => ({ [b.slots.order]: 42 }),
      install: () => ({ flows: [] }),
    });
    expect(() => createFlowState({ kits: [b(), wrong()], stores })).toThrow(/slot "b\.order".*kit "wrong"/);
  });

  it("refuses a kit whose requirement is not installed, and a cycle", () => {
    const { b, c } = chain();
    expect(() => createFlowState({ kits: [c()], stores })).toThrow(/kit "c" requires kit "b", which is not installed/);

    // `x` names `y` by its shape, since a factory can't require one defined after it.
    const x = defineKit({ name: "x", requires: [{ kitName: "y", slots: {} }], install: () => ({ flows: [] }) });
    const y = defineKit({ name: "y", requires: [x], install: () => ({ flows: [] }) });
    expect(() => createFlowState({ kits: [x(), y(), b()], stores })).toThrow(/require each other: "x", "y"/);
  });

  it("refuses one kit installed twice", () => {
    const { b } = chain();
    expect(() => createFlowState({ kits: [b(), b()], stores })).toThrow(/kit "b" is listed twice/);
  });
});

describe("a kit's folder", () => {
  /** A kit `notes` whose reader claims `greeting.txt` and hands its text to install. */
  function notesKit(onInstall: (text: string) => void = () => undefined) {
    return defineKit({
      name: "notes",
      directory: {
        path: "notes",
        read: async (folder: KitFolder) => {
          const { readFile } = await import("node:fs/promises");
          folder.claim("greeting.txt");
          return readFile(join(folder.path, "greeting.txt"), "utf8");
        },
      },
      install: ({ folder }) => {
        onInstall(folder);
        return { flows: [flowOf("notes-flow")] };
      },
    });
  }

  it("reads its default folder against the app's root", async () => {
    const app = tempDir({ "notes/greeting.txt": "hello from the app" });
    let text = "";
    const state = track(createFlowState({ kits: [notesKit((t) => (text = t))()], root: app, stores }));
    await state.ready();
    expect(text).toBe("hello from the app");
  });

  it("reads a relative path the app gives in config against the working directory", async () => {
    const elsewhere = tempDir({ "greeting.txt": "hello from elsewhere" });
    const app = tempDir({ "notes/greeting.txt": "hello from the app" });
    let text = "";
    const state = track(
      createFlowState({
        kits: [notesKit((t) => (text = t))({ directory: relative(process.cwd(), elsewhere) })],
        root: app,
        stores,
      }),
    );
    await state.ready();
    expect(text).toBe("hello from elsewhere");
  });

  it("refuses to start beside a file no reader used, naming every one, and installs nothing", async () => {
    const app = tempDir({ "notes/greeting.txt": "hi", "notes/notes.txt": "stray", "notes/old/draft.md": "stray" });
    let installed = false;
    const state = track(createFlowState({ kits: [notesKit(() => (installed = true))()], root: app, stores }));

    const failure = state.ready().then(
      () => "started",
      (err: Error) => err.message,
    );
    const message = await failure;
    expect(message).toMatch(/kit "notes"/);
    expect(message).toMatch(/"notes\.txt"/);
    expect(message).toMatch(/"old"/);
    expect(installed).toBe(false);
    // Every later entry point gets the same refusal.
    await expect(state.getRuntime()).rejects.toThrow(/"notes\.txt"/);
  });

  it("refuses a folder path spelled with a .. through a symlink, rather than reading where the spelling collapses to", async () => {
    // `<app>/linked/..` is `<app>` to a lexical join, and `<outside>/..` to the
    // kernel. Normalizing before the check would read `<app>/notes` and pass.
    const app = tempDir({ "notes/greeting.txt": "hi" });
    const outside = tempDir({ "inner/x.txt": "x" });
    symlinkSync(join(outside, "inner"), join(app, "linked"));
    const state = track(
      createFlowState({ kits: [notesKit()({ directory: `${app}/linked/../notes` })], root: app, stores }),
    );
    await expect(state.ready()).rejects.toThrow(/spelled with a "\.\." that steps back/);

    // The same through the app's root, which the kit's default folder joins.
    const viaRoot = track(createFlowState({ kits: [notesKit()()], root: `${app}/linked/..`, stores }));
    await expect(viaRoot.ready()).rejects.toThrow(/spelled with a "\.\." that steps back/);
  });

  it("refuses two kits on one folder", () => {
    const app = tempDir({ "shared/greeting.txt": "hi" });
    const notes = notesKit();
    const other = defineKit({
      name: "other",
      directory: { path: "shared", read: () => undefined },
      install: () => ({ flows: [] }),
    });
    expect(() =>
      createFlowState({ kits: [notes({ directory: join(app, "shared") }), other()], root: app, stores }),
    ).toThrow(/kits "notes" and "other" both read the folder/);
  });
});
