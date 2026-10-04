/**
 * `mergeSeatFlows`: hired seats join an app's flows record without replacing
 * any flow already in it.
 *
 * An org seat's id is its bare folder name, so a folder named like one of the
 * app's flows (`mailbox`, `chatAgent`) would otherwise take that flow's key and
 * the flow would vanish from the server with nothing said.
 */
import { describe, expect, it } from "vitest";
import { mergeSeatFlows } from "../src";

const flow = (id: string, kind = id) => ({ id, kind }) as never;

describe("mergeSeatFlows", () => {
  it("adds each seat under its id beside the app's flows", () => {
    const merged = mergeSeatFlows({ mailbox: flow("mailbox") }, [flow("eng.em", "em"), flow("chief-of-staff", "agent")]);
    expect(Object.keys(merged).sort()).toEqual(["chief-of-staff", "eng.em", "mailbox"]);
  });

  it("refuses a seat whose id is already a flow's, naming both, and leaves the input alone", () => {
    const flows = { mailbox: flow("mailbox") };
    expect(() => mergeSeatFlows(flows, [flow("mailbox", "agent")])).toThrow(/seat "mailbox".*flow "mailbox"/);
    expect(Object.keys(flows)).toEqual(["mailbox"]);
  });

  it("refuses two seats with one id", () => {
    expect(() => mergeSeatFlows({}, [flow("eng.em", "em"), flow("eng.em", "agent")])).toThrow(/"eng\.em".*more than once/);
  });
});
