/**
 * The team-list rule: a hired seat's inventory row is listed only while the
 * roster backs it; a declared seat's row is listed as it is.
 */
import { describe, expect, it } from "vitest";
import { listedSeatRows } from "../src/browser";

const declared = [
  { id: "eng.lead", kind: "agent", hired: false },
  { id: "chief-of-staff", kind: "agent", hired: false },
];

describe("listedSeatRows", () => {
  it("BR-22 · a hired seat's row with no roster row (as a crash between fire's deletes leaves it) is not listed", () => {
    const rows = [
      ...declared,
      { id: "acme.support.joe", kind: "desk-clerk", hired: true },
      { id: "acme.support.ada", kind: "agent", hired: true },
    ];
    const listed = listedSeatRows("acme", rows, [{ seatId: "support.ada" }]);
    expect(listed.map((row) => row.id)).toEqual(["eng.lead", "chief-of-staff", "acme.support.ada"]);
  });

  it("BR-22 · a row from before rows said where they came from is read by its id: an earlier fire's leftover is not listed", () => {
    // Today's fire left exactly this: `{ id, kind, door }`, no `hired`.
    const rows = [{ id: "eng.lead", kind: "agent" }, { id: "acme.support.joe", kind: "desk-clerk" }];
    expect(listedSeatRows("acme", rows, []).map((row) => row.id)).toEqual(["eng.lead"]);
  });

  it("BR-23 · declared seats are listed as today, a dotless org seat included", () => {
    expect(listedSeatRows("acme", declared, [])).toEqual(declared);
  });

  it("BR-23 · a declared team that shares the organization's name stays listed, with no roster row", () => {
    // Org `acme`, declared team `acme`: `acme.support.ada` splits as an
    // address in `acme`, and only the row's origin tells it from a hire.
    const rows = [{ id: "acme.support.ada", kind: "agent", hired: false }];
    expect(listedSeatRows("acme", rows, [])).toEqual(rows);
    expect(listedSeatRows("acme", rows, undefined)).toEqual(rows);
  });

  it("BR-24 · with no roster, no hired seat is listed and declared seats still are", () => {
    const rows = [...declared, { id: "acme.support.ada", kind: "agent", hired: true }];
    expect(listedSeatRows("acme", rows, undefined).map((row) => row.id)).toEqual(["eng.lead", "chief-of-staff"]);
  });

  it("a user-owned hire's row is listed only while its owner's roster row carries the same incarnation", () => {
    const rows = [...declared, { id: "acme.~u1.research", kind: "agent", hired: true, incarnation: "i-1" }];
    const live = [{ seatId: "research", ownerUserId: "u1", incarnation: "i-1" }];
    expect(listedSeatRows("acme", rows, [], live).map((row) => row.id)).toEqual(["eng.lead", "chief-of-staff", "acme.~u1.research"]);
    // The owner's row is another hire's now: this inventory row isn't its.
    expect(listedSeatRows("acme", rows, [], [{ ...live[0]!, incarnation: "i-2" }]).map((row) => row.id)).toEqual(["eng.lead", "chief-of-staff"]);
    // Another member's row under the same seat id backs nothing at u1's address.
    expect(listedSeatRows("acme", rows, [], [{ ...live[0]!, ownerUserId: "u2" }]).map((row) => row.id)).toEqual(["eng.lead", "chief-of-staff"]);
    // A user-owned row from before incarnations matches no roster row.
    expect(listedSeatRows("acme", [{ id: "acme.~u1.old", kind: "agent", hired: true }], [], [{ seatId: "old", ownerUserId: "u1", incarnation: null }])).toEqual([]);
  });

  it("the row a fire leaves when it stops after deleting the owner's roster row is not listed, incarnation and all", () => {
    // The crash state: the private roster row is gone, the inventory row is
    // exactly what the hire published. Its incarnation says which hire
    // published it, not that the hire is still there.
    const rows = [...declared, { id: "acme.~u1.research", kind: "agent", hired: true, incarnation: "i-1" }];
    expect(listedSeatRows("acme", rows, [], []).map((row) => row.id)).toEqual(["eng.lead", "chief-of-staff"]);
    // A reader that can't read the owner's roster (a browser) can't back it either.
    expect(listedSeatRows("acme", rows, []).map((row) => row.id)).toEqual(["eng.lead", "chief-of-staff"]);
  });

  it("another organization's roster row backs nothing here, and a user-owned address is never backed by the org roster", () => {
    const rows = [
      { id: "acme.support.ada", kind: "agent", hired: true },
      { id: "acme.~u1.support.ada", kind: "agent", hired: true },
    ];
    expect(listedSeatRows("globex", rows, [{ seatId: "support.ada" }])).toEqual([]);
    expect(listedSeatRows("acme", rows, [{ seatId: "support.ada" }]).map((row) => row.id)).toEqual(["acme.support.ada"]);
  });
});
