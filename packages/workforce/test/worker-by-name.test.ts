/**
 * `findWorkerByName`: the one lookup from a worker's name to the worker
 * holding it, as the caller may reach it.
 *
 * A name is the one `members:` and `discover` use (the `seatId` the hire
 * stamps), never an address. The workers searched are the caller's
 * organization's and the caller's own; anyone else's, and anything that is not
 * a worker, is not there. Two workers holding one name is an answer nobody
 * can act on, so it is refused naming both.
 */
import { describe, expect, it } from "vitest";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { findWorkerByName } from "../src/worker-by-name";

/** A registered instance as the registry lists it: an address, settings, and maybe a pin. */
function worker(id: string, seatId: string | undefined, ownerPin?: { orgId: string; userId?: string }): FlowInstance {
  return {
    id,
    kind: "agent",
    ...(seatId === undefined ? {} : { config: { seatId } }),
    ...(ownerPin === undefined ? {} : { ownerPin })
  } as unknown as FlowInstance;
}

const CALLER = { orgId: "acme", userId: "u_amy" };

describe("findWorkerByName", () => {
  it("finds a declared worker, an org hire and the caller's own hire by name, never by address", () => {
    const workers = [
      worker("eng.lead", "eng.lead"),
      worker("acme.eng.ada", "eng.ada", { orgId: "acme" }),
      worker("acme.~u_amy.eng.mine", "eng.mine", { orgId: "acme", userId: "u_amy" })
    ];
    expect(findWorkerByName(workers, "eng.lead", CALLER)?.id).toBe("eng.lead");
    expect(findWorkerByName(workers, "eng.ada", CALLER)?.id).toBe("acme.eng.ada");
    expect(findWorkerByName(workers, "eng.mine", CALLER)?.id).toBe("acme.~u_amy.eng.mine");
    expect(findWorkerByName(workers, "acme.eng.ada", CALLER)).toBeUndefined();
  });

  it("finds nothing for a name no worker holds, another org's worker, a teammate's own, or a flow that is not a worker", () => {
    const workers = [
      worker("globex.eng.ada", "eng.ada", { orgId: "globex" }),
      worker("acme.~u_bob.eng.bob", "eng.bob", { orgId: "acme", userId: "u_bob" }),
      worker("mailbox", undefined)
    ];
    expect(findWorkerByName(workers, "eng.zed", CALLER)).toBeUndefined();
    expect(findWorkerByName(workers, "eng.ada", CALLER)).toBeUndefined();
    expect(findWorkerByName(workers, "eng.bob", CALLER)).toBeUndefined();
    expect(findWorkerByName(workers, "mailbox", CALLER)).toBeUndefined();
  });

  it("refuses a name two reachable workers hold, naming both", () => {
    const workers = [
      worker("acme.eng.ada", "eng.ada", { orgId: "acme" }),
      worker("acme.~u_amy.eng.ada", "eng.ada", { orgId: "acme", userId: "u_amy" })
    ];
    expect(() => findWorkerByName(workers, "eng.ada", CALLER)).toThrow(
      /"eng\.ada".*two workers.*"acme\.eng\.ada".*"acme\.~u_amy\.eng\.ada"/
    );
  });
});
