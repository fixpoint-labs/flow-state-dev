/**
 * `mergeSeatFlows`: hired seats join an app's flows record without replacing
 * any flow already in it.
 *
 * An org seat's id is its bare folder name, so a folder named like one of the
 * app's flows (`coordinator`, `chatAgent`) would otherwise take that flow's key and
 * the flow would vanish from the server with nothing said.
 */
import { describe, expect, it } from "vitest";
import { mergeSeatFlows } from "../src";

const flow = (id: string, kind = id) => ({ id, kind }) as never;

describe("mergeSeatFlows", () => {
  it("adds each seat under its id beside the app's flows", () => {
    const merged = mergeSeatFlows({ coordinator: flow("coordinator") }, [flow("eng.em", "em"), flow("chief-of-staff", "agent")]);
    expect(Object.keys(merged).sort()).toEqual(["chief-of-staff", "coordinator", "eng.em"]);
  });

  it("refuses a seat whose id is already a flow's, naming both, and leaves the input alone", () => {
    const flows = { coordinator: flow("coordinator") };
    expect(() => mergeSeatFlows(flows, [flow("coordinator", "agent")])).toThrow(/seat "coordinator".*flow "coordinator"/);
    expect(Object.keys(flows)).toEqual(["coordinator"]);
  });

  it("refuses two seats with one id", () => {
    expect(() => mergeSeatFlows({}, [flow("eng.em", "em"), flow("eng.em", "agent")])).toThrow(/"eng\.em".*more than once/);
  });
});
