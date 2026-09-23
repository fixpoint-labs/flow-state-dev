/**
 * The read-only mark in the Resources tree (FIX-1481, ER-Devtool checklist
 * row 6). V3 and V5 from the plan.
 *
 * **The mark is the seal: `writable === false`, and nothing else.** That is
 * the one condition the store itself refuses a write on, so the mark means
 * *immutable to everyone* — from code and from a model alike (BR-17).
 *
 * The seal has two producers and one meaning: a document loaded out of a
 * `references/` folder, and an ordinary mutable document a seat holds under a
 * read-only grant. Both land on the same setting, which is why the mark reads
 * the setting rather than the folder (BR-10, BR-11).
 *
 * The two ways to get it wrong both have a case here, and both go red if the
 * predicate drifts:
 *
 * - **BR-13**, the near miss. A document writable by code but not offered to a
 *   model is NOT read-only. `llmWritable` is opt-in, so approximating the mark
 *   from it would brand most of the tree and distinguish nothing — the
 *   `resources/` document row 6 exists to tell apart from a reference
 *   included.
 * - **BR-12 and BR-15**, absence. A setting nobody declared, and a server that
 *   predates this and sends neither, both mean *writable*. A wrong mark is
 *   worse than no mark.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import type { DebugResourceEntry } from "@flow-state-dev/client";
import { ResourcesTree } from "../src/react/components/detail/resources-tree";

let counter = 0;

/** One tree entry. Permission settings are supplied only where a case needs them. */
function entry(
  primaryName: string,
  permissions: Partial<Pick<DebugResourceEntry, "writable" | "llmWritable">> = {},
  overrides: Partial<DebugResourceEntry> = {}
): DebugResourceEntry {
  return {
    definitionId: `dr_${++counter}`,
    aliases: [primaryName],
    primaryName,
    scope: "org",
    isCollection: false,
    state: null,
    clientView: null,
    hasContent: false,
    contentVisibleToClient: false,
    clientConfig: {
      hasClient: false,
      data: false,
      stateRead: false,
      contentRead: false,
      prefetchWindow: null
    },
    ...permissions,
    ...overrides
  };
}

function renderTree(...entries: DebugResourceEntry[]) {
  render(<ResourcesTree sessionId="sess_1" resources={entries} />);
}

/** The header button for one row, so a mark is read on its own row. */
function rowFor(primaryName: string): HTMLElement {
  const label = screen.getByText(primaryName);
  const row = label.closest("button");
  expect(row, `no row for ${primaryName}`).not.toBeNull();
  return row as HTMLElement;
}

function isMarked(primaryName: string): boolean {
  return within(rowFor(primaryName)).queryByText(/read-only/i) !== null;
}

describe("the mark is the seal", () => {
  it("BR-9 · marks a document that declares `writable: false`", () => {
    renderTree(entry("handbook", { writable: false, llmWritable: false }));

    expect(isMarked("handbook")).toBe(true);
  });

  it("BR-9 · marks it whatever `llmWritable` says", () => {
    // The mark reads one setting. A sealed document a model happens to be
    // offered a write tool for is still sealed — the store refuses the write.
    renderTree(entry("oddly-configured", { writable: false, llmWritable: true }));

    expect(isMarked("oddly-configured")).toBe(true);
  });

  it("BR-10 and BR-11 · marks both producers of the seal, identically", () => {
    // A `references/` document and a seat's read-only grant are minted two
    // different ways and arrive as the same setting. Asserted together,
    // because a folder-derived mark would be right about the first and
    // silent about the second — and the silent one is the more dangerous:
    // the reader is looking at something that IS mutable for somebody else.
    renderTree(
      entry("references-doc", { writable: false, llmWritable: false }),
      entry("granted-ro-doc", { writable: false, llmWritable: false })
    );

    expect(isMarked("references-doc")).toBe(true);
    expect(isMarked("granted-ro-doc")).toBe(true);
  });

  it("BR-9 · leaves a writable neighbour unmarked in the same tree", () => {
    renderTree(
      entry("handbook", { writable: false, llmWritable: false }),
      entry("scratchpad")
    );

    expect(isMarked("handbook")).toBe(true);
    expect(isMarked("scratchpad")).toBe(false);
  });

  it("marks an external collection, which is unwritable without declaring it", () => {
    // An external collection has no `writable` field to declare and is refused
    // every mutator by the registry, so the server reports `writable: false`
    // for it on structural grounds. The tree needs no second condition for
    // that — the one predicate already covers it, which is the whole reason
    // the fix went server-side rather than teaching this component a config
    // taxonomy.
    renderTree(
      entry(
        "externalPositions",
        { writable: false },
        { isCollection: true, collectionPattern: "positions/*", itemCount: 0 }
      )
    );

    expect(isMarked("externalPositions")).toBe(true);
  });

  it("BR-14 · marks a sealed collection, not its items one by one", () => {
    renderTree(
      entry(
        "handbookPages",
        { writable: false, llmWritable: false },
        { isCollection: true, collectionPattern: "handbook/[topic]", itemCount: 4 }
      )
    );

    expect(isMarked("handbookPages")).toBe(true);
    // Collapsed, so no item has rendered at all — the mark is on the row that
    // carries the settings, which is the collection's.
    expect(screen.getAllByText(/read-only/i)).toHaveLength(1);
  });
});

describe("what the mark must not claim", () => {
  it("BR-13 · does NOT mark a document that is writable by code and closed to the model", () => {
    // THE CASE THAT CATCHES A DRIFTING PREDICATE. `llmWritable` is opt-in, so
    // this is the ordinary state of most of the tree. Marking it would make
    // the badge meaningless — and it would mark the `resources/` document row
    // 6 exists to distinguish from a reference.
    renderTree(entry("mutable-doc", { llmWritable: false }));

    expect(isMarked("mutable-doc")).toBe(false);
  });

  it("BR-12 · does not mark a document that declares neither setting", () => {
    // Absent means writable — the framework's default. The setting is left
    // out entirely here rather than set to `true`, which is the shape a real
    // config produces.
    renderTree(entry("plain-doc"));

    expect(isMarked("plain-doc")).toBe(false);
  });

  it("BR-15 · renders no mark and throws nothing against a server that sends neither key", () => {
    // The second path (BP-035). An older server's entry has no knowledge of
    // either setting, so the keys are deleted rather than set to anything.
    const old = entry("legacy-doc", { writable: false, llmWritable: false });
    delete (old as Partial<DebugResourceEntry>).writable;
    delete (old as Partial<DebugResourceEntry>).llmWritable;

    expect(() => renderTree(old)).not.toThrow();
    expect(isMarked("legacy-doc")).toBe(false);
    expect(screen.queryByText(/read-only/i)).toBeNull();
  });
});

describe("what the mark says it means", () => {
  it("BR-17 · scopes the claim to this handle, and does not promise immutability", () => {
    // The claim the mark makes is the thing a reader acts on, so it has to be
    // true in every supported case. "Immutable to everyone" is not:
    //
    //  - a `writable: false` COLLECTION still permits `create` and `delete`
    //    (`resource-registry.ts` consults the flag in neither), and
    //  - the flag is on the definition, not the storage cell, so a seat's
    //    read-only grant — a shallow copy with both doors shut — leaves the
    //    same shared org/user cell writable through another flow's own
    //    definition.
    //
    // Asserted on the wording rather than left to review, because the
    // overclaiming version read as more reassuring and survived one round.
    renderTree(entry("handbook", { writable: false, llmWritable: false }));

    const title = within(rowFor("handbook"))
      .getByText(/read-only/i)
      .closest("span")
      ?.getAttribute("title") ?? "";

    // What it must say: the subject of the refusal is THIS HANDLE, and what
    // is refused is state and content writes. Matched on "this handle" rather
    // than an exact phrase, so a reword survives but a change of subject does
    // not — the first version of this test pinned the phrasing and went red on
    // a shortening that was strictly better.
    expect(title).toMatch(/this handle/i);
    expect(title).toMatch(/state and content writes/i);
    // What it must not say — the retracted claim, in the two shapes it took.
    expect(title).not.toMatch(/immutable to everyone/i);
    expect(title).not.toMatch(/refuses every write/i);
    // ...nor any unqualified promise about the data behind the handle.
    expect(title).not.toMatch(/cannot be written at all/i);
  });
});

describe("what the row keeps saying", () => {
  it("BR-16 · still shows the scope badge it shows today, marked or not", () => {
    renderTree(
      entry("handbook", { writable: false, llmWritable: false }),
      entry("scratchpad", {}, { scope: "session" })
    );

    expect(within(rowFor("handbook")).getByText("org")).toBeInTheDocument();
    expect(within(rowFor("scratchpad")).getByText("session")).toBeInTheDocument();
  });

  it("BR-17 · answers the model-gate question in the row detail, separately from the mark", () => {
    // The mark means one thing. The OTHER question — is a model offered a
    // write tool — is a real question with a different answer, and the row
    // detail carries both settings so a reader can tell them apart without
    // the mark pretending to answer the second.
    renderTree(entry("mutable-doc", { llmWritable: false }));

    fireEvent.click(rowFor("mutable-doc"));

    expect(screen.getByText(/llmWritable: false/)).toBeInTheDocument();
    // ...and it is still not a read-only mark.
    expect(isMarked("mutable-doc")).toBe(false);
  });

  it("BR-17 · shows both settings on a sealed row's detail", () => {
    renderTree(entry("handbook", { writable: false, llmWritable: false }));

    fireEvent.click(rowFor("handbook"));

    expect(screen.getByText(/writable: false/)).toBeInTheDocument();
    expect(screen.getByText(/llmWritable: false/)).toBeInTheDocument();
  });

  it("says nothing about a setting nobody declared", () => {
    renderTree(entry("plain-doc"));

    fireEvent.click(rowFor("plain-doc"));

    expect(screen.queryByText(/writable:/)).toBeNull();
  });
});
