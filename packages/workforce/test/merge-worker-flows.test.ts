/**
 * `mergeWorkerFlows`: hired workers join an app's flows record without replacing
 * any flow already in it.
 *
 * An org worker's id is its bare folder name, so a folder named like one of the
 * app's flows (`coordinator`, `chatAgent`) would otherwise take that flow's key and
 * the flow would vanish from the server with nothing said.
 */
import { describe, expect, it } from "vitest";
import { mergeWorkerFlows } from "../src";

const flow = (id: string, flowName = id) => ({ id, kind: flowName }) as never;

describe("mergeWorkerFlows", () => {
  it("adds each worker under its id beside the app's flows", () => {
    const merged = mergeWorkerFlows({ coordinator: flow("coordinator") }, [flow("eng.em", "em"), flow("shift-coordinator", "agent")]);
    expect(Object.keys(merged).sort()).toEqual(["shift-coordinator", "coordinator", "eng.em"]);
  });

  it("refuses a worker whose id is already a flow's, naming both, and leaves the input alone", () => {
    const flows = { coordinator: flow("coordinator") };
    expect(() => mergeWorkerFlows(flows, [flow("coordinator", "agent")])).toThrow(/worker "coordinator".*flow "coordinator"/);
    expect(Object.keys(flows)).toEqual(["coordinator"]);
  });

  it("refuses two workers with one id", () => {
    expect(() => mergeWorkerFlows({}, [flow("eng.em", "em"), flow("eng.em", "agent")])).toThrow(/"eng\.em".*more than once/);
  });
});
