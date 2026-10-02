/**
 * `mergeSeatFlows`: hired seats join an app's flows record without replacing
 * any flow already in it.
 *
 * An org seat's id is its bare folder name, so a folder named like one of the
 * app's flows (`channel`, `chatAgent`) would otherwise take that flow's key and
 * the flow would vanish from the server with nothing said.
 */
import { describe, expect, it } from "vitest";
import { mergeSeatFlows } from "../src";

const flow = (id: string, kind = id) => ({ id, kind }) as never;

describe("mergeSeatFlows", () => {
  it("adds each seat under its id beside the app's flows", () => {
    const merged = mergeSeatFlows({ channel: flow("channel") }, [flow("eng.em", "em"), flow("chief-of-staff", "agent")]);
    expect(Object.keys(merged).sort()).toEqual(["channel", "chief-of-staff", "eng.em"]);
  });

  it("refuses a seat whose id is already a flow's, naming both, and leaves the input alone", () => {
    const flows = { channel: flow("channel") };
    expect(() => mergeSeatFlows(flows, [flow("channel", "agent")])).toThrow(/seat "channel".*flow "channel"/);
    expect(Object.keys(flows)).toEqual(["channel"]);
  });

  it("refuses two seats with one id", () => {
    expect(() => mergeSeatFlows({}, [flow("eng.em", "em"), flow("eng.em", "agent")])).toThrow(/"eng\.em".*more than once/);
  });
});
