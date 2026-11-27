import { describe, expect, it } from "vitest";
import { covers, hearsNotice, mayHold, type ViewHearing } from "../src/types/view-hearing";

describe("the path rule", () => {
  // FIX-1506's rule.
  it("mayHold: every doubt a yes", () => {
    expect(mayHold("roster/a", ["roster"])).toBe(true);
    expect(mayHold("workforce/workers/a", ["roster", "workforce/workers"])).toBe(true);
    expect(mayHold("workforce/other/a", ["roster", "workforce/workers"])).toBe(false);
    expect(mayHold("anything", undefined)).toBe(true);
    expect(mayHold("anything", ["roster", ""])).toBe(true);
    // A change at an ancestor of a root may touch anything beneath it.
    expect(mayHold("notes", ["notes/shared"])).toBe(true);
    expect(mayHold("notes/private", ["notes/shared"])).toBe(false);
    expect(mayHold("note", ["notes/shared"])).toBe(false);
  });
});

describe("covers", () => {
  it("matches scope, the session's id, and a narrowed resource", () => {
    expect(covers({ scope: "user" }, { scope: "user", resource: "notes" })).toBe(true);
    expect(covers({ scope: "user" }, { scope: "org" })).toBe(false);
    expect(covers({ scope: "session", id: "s1" }, { scope: "session", id: "s1" })).toBe(true);
    // One session never hears another's notices.
    expect(covers({ scope: "session", id: "s1" }, { scope: "session", id: "s2" })).toBe(false);
    expect(covers({ scope: "user", resource: "notes" }, { scope: "user", resource: "notes" })).toBe(true);
    expect(covers({ scope: "user", resource: "notes" }, { scope: "user", resource: "tasks" })).toBe(false);
    expect(covers({ scope: "user", resource: "notes" }, { scope: "user" })).toBe(false);
  });
});

describe("hearsNotice", () => {
  const hears: ViewHearing[] = [
    { topic: { scope: "session", id: "s1" }, kinds: ["items", "state"] },
    { topic: { scope: "user" }, kinds: ["resource"], paths: ["notes"] },
  ];

  it("hears everything for an answer that names no hearing", () => {
    expect(hearsNotice(undefined, { topic: { scope: "org" }, kind: "state" })).toBe(true);
  });

  it("needs a covering topic and a listed kind", () => {
    expect(hearsNotice(hears, { topic: { scope: "session", id: "s1" }, kind: "items" })).toBe(true);
    expect(hearsNotice(hears, { topic: { scope: "session", id: "s1" }, kind: "run" })).toBe(false);
    expect(hearsNotice(hears, { topic: { scope: "session", id: "s2" }, kind: "items" })).toBe(false);
  });

  it("gates a resource notice on the hearing's roots, unless it names no path", () => {
    expect(hearsNotice(hears, { topic: { scope: "user", resource: "notes/a" }, kind: "resource" })).toBe(true);
    expect(hearsNotice(hears, { topic: { scope: "user", resource: "tasks/a" }, kind: "resource" })).toBe(false);
    expect(hearsNotice(hears, { topic: { scope: "user" }, kind: "resource" })).toBe(true);
  });

  it("leaves a resync to the watcher: unlisted, it is not heard here", () => {
    expect(hearsNotice(hears, { topic: { scope: "session", id: "s1" }, kind: "resync" })).toBe(false);
  });
});

// FIX-2750.
describe("hearsNotice, for a board notice that names its partition", () => {
  const board = { scope: "user", resource: "tasks" } as const;
  const readA: ViewHearing[] = [{ topic: board, kinds: ["board"], partitions: ["key-a"] }];
  const readWhole: ViewHearing[] = [{ topic: board, kinds: ["board"] }];

  it("wakes an answer that read the notice's partition, even one it read empty", () => {
    expect(hearsNotice(readA, { topic: board, kind: "board", partition: "key-a" })).toBe(true);
  });

  it("does not wake an answer that read only other partitions: another conversation's filing costs no read", () => {
    expect(hearsNotice(readA, { topic: board, kind: "board", partition: "key-b" })).toBe(false);
  });

  it("wakes every board for a notice that names no partition: an older server's", () => {
    expect(hearsNotice(readA, { topic: board, kind: "board" })).toBe(true);
  });

  it("wakes an answer that read the board whole, or names no partitions: an unpartitioned ledger, an older server", () => {
    expect(hearsNotice(readWhole, { topic: board, kind: "board", partition: "key-b" })).toBe(true);
  });

  it("narrows board notices only: a partition never gates another kind", () => {
    const both: ViewHearing[] = [{ topic: board, kinds: ["board", "resource"], partitions: ["key-a"] }];
    expect(hearsNotice(both, { topic: board, kind: "resource", partition: "key-b" })).toBe(true);
  });
});
