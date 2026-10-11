/**
 * `mergeWorkerFlows`: hired workers join an app's flows record without replacing
 * any flow already in it.
 *
 * An org worker's id is its bare folder name, so a folder named like one of the
 * app's flows (`mailbox`, `chatAgent`) would otherwise take that flow's key and
 * the flow would vanish from the server with nothing said.
 */
import { describe, expect, it } from "vitest";
import { mergeWorkerFlows } from "../src";

const flow = (id: string, kind = id) => ({ id, kind }) as never;

describe("mergeWorkerFlows", () => {
  it("adds each worker under its id beside the app's flows", () => {
    const merged = mergeWorkerFlows({ mailbox: flow("mailbox") }, [flow("eng.em", "em"), flow("chief-of-staff", "agent")]);
    expect(Object.keys(merged).sort()).toEqual(["chief-of-staff", "eng.em", "mailbox"]);
  });

  it("refuses a worker whose id is already a flow's, naming both, and leaves the input alone", () => {
    const flows = { mailbox: flow("mailbox") };
    expect(() => mergeWorkerFlows(flows, [flow("mailbox", "agent")])).toThrow(/worker "mailbox".*flow "mailbox"/);
    expect(Object.keys(flows)).toEqual(["mailbox"]);
  });

  it("refuses two workers with one id", () => {
    expect(() => mergeWorkerFlows({}, [flow("eng.em", "em"), flow("eng.em", "agent")])).toThrow(/"eng\.em".*more than once/);
  });
});
