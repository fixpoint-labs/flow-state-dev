/**
 * The team-list rule: a hired seat's inventory row is listed only while the
 * roster backs it; a declared seat's row is listed as it is.
 */
import { describe, expect, it } from "vitest";
import { listedSeatRows } from "../src/browser";

const declared = [
  { id: "eng.lead", kind: "agent" },
  { id: "chief-of-staff", kind: "agent" },
];

describe("listedSeatRows", () => {
  it("BR-22 · a hired seat's row with no roster row (as an earlier fire left it) is not listed", () => {
    const rows = [...declared, { id: "acme.support.joe", kind: "desk-clerk" }, { id: "acme.support.ada", kind: "agent" }];
    const listed = listedSeatRows("acme", rows, [{ seatId: "support.ada" }]);
    expect(listed.map((row) => row.id)).toEqual(["eng.lead", "chief-of-staff", "acme.support.ada"]);
  });

  it("BR-23 · declared seats are listed as today, a dotless org seat included", () => {
    expect(listedSeatRows("acme", declared, [])).toEqual(declared);
  });

  it("BR-24 · with no roster, no hired seat is listed and declared seats still are", () => {
    const rows = [...declared, { id: "acme.support.ada", kind: "agent" }];
    expect(listedSeatRows("acme", rows, undefined).map((row) => row.id)).toEqual(["eng.lead", "chief-of-staff"]);
  });

  it("another organization's roster row backs nothing here, and a user-owned address is never backed by the org roster", () => {
    const rows = [{ id: "acme.support.ada", kind: "agent" }, { id: "acme.~u1.support.ada", kind: "agent" }];
    expect(listedSeatRows("globex", rows, [{ seatId: "support.ada" }]).map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(listedSeatRows("acme", rows, [{ seatId: "support.ada" }]).map((row) => row.id)).toEqual(["acme.support.ada"]);
  });

  it("known limit · a declared team whose id equals the organization's reads as hired", () => {
    expect(listedSeatRows("eng", declared, [])).toEqual([{ id: "chief-of-staff", kind: "agent" }]);
  });
});
