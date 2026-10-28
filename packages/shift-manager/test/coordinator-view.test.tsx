// @vitest-environment happy-dom
/**
 * The Shift Coordinator as a coordinator (FIX-1791 S10): its delegates panel,
 * its routing records drawn apart from the conversation's lines, and a
 * delegate's answer labelled with the delegate's name.
 *
 * Checks (`specs/issues/FIX-1791/BUSINESS-RULES.md`): BR-33's panel (list,
 * add from the user's roster, remove; a refused add shows its reason and
 * changes nothing), BR-29 (a `coordinator-route` record is never drawn as a
 * line), and BR-20's "under the delegate's name".
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentItem } from "@flow-state-dev/core/items";
import { DelegatesPanel } from "../src/components/DelegatesPanel";
import { CoordinatorRoute } from "../src/components/CoordinatorRoute";
import { shiftManagerRenderers } from "../src/components/ToolLine";
import { knownWorkers, senderOf } from "../src/lib/conversation";
import { toWorker } from "../src/lib/reads";

let listed: Array<{ worker: string; note?: string }> = [];
const calls: string[] = [];
let refuseAdd: string | null = null;

// One connection and one workforce client, as the app memoizes them per Lab.
vi.mock("../src/lib/lab-data", () => {
  const lab = { client: { userId: "alice" } };
  return { useLab: () => lab };
});
vi.mock("../src/lib/workforce", () => {
  const workforce = {
    roster: async () => [
      { id: "shift-coordinator", flow: "coordinator", standard: true, description: null },
      { id: "eng.em", flow: "em", standard: true, description: null, name: "Engineering Manager" },
      { id: "licenses", flow: "agent", standard: false, description: "Audits licenses.", name: null },
      { id: "eng.reviewer", flow: "agent", standard: true, description: null, name: "Reviewer" },
      { id: "ops.reviewer", flow: "agent", standard: true, description: null, name: "Reviewer" },
    ],
  };
  return { useWorkforce: () => workforce };
});
vi.mock("../src/lib/delegates", () => ({
  readDelegates: async (_c: unknown, flow: string, sessionId: string) => {
    calls.push(`list ${flow} ${sessionId}`);
    return { delegates: [...listed], max: 25 };
  },
  addDelegate: async (_c: unknown, flow: string, sessionId: string, worker: string) => {
    calls.push(`add ${flow} ${sessionId} ${worker}`);
    if (refuseAdd !== null) throw new Error(refuseAdd);
    listed = [...listed, { worker }];
    return { delegates: [...listed], max: 25 };
  },
  removeDelegate: async (_c: unknown, flow: string, sessionId: string, worker: string) => {
    calls.push(`remove ${flow} ${sessionId} ${worker}`);
    listed = listed.filter((d) => d.worker !== worker);
    return { delegates: [...listed], max: 25 };
  },
}));

const shiftCoordinator = toWorker({ id: "shift-coordinator", kind: "coordinator", door: "run" })!;

beforeEach(() => {
  listed = [{ worker: "eng.em" }];
  calls.length = 0;
  refuseAdd = null;
});
afterEach(cleanup);

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the delegates panel (BR-33)", () => {
  it("says the delegates belong to a conversation before there is one, and reads nothing", async () => {
    render(<DelegatesPanel worker={shiftCoordinator} sessionId={null} />);
    await settle();
    expect(screen.getByTestId("shift-coordinator-delegates-none")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("lists the conversation's delegates, and offers the user's roster minus the coordinator and those listed", async () => {
    render(<DelegatesPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    expect(calls).toEqual(["list coordinator s1"]);
    expect(screen.getAllByTestId("shift-coordinator-delegate").map((li) => li.getAttribute("data-worker"))).toEqual(["eng.em"]);
    const options = [...(screen.getByTestId("shift-coordinator-delegate-pick") as HTMLSelectElement).options].map((o) => o.value);
    expect(options).toEqual(["", "licenses", "eng.reviewer", "ops.reviewer"]);
  });

  it("names delegates and choices by display name, with the id only where two share a name", async () => {
    render(<DelegatesPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    expect(screen.getAllByTestId("shift-coordinator-delegate").map((li) => li.textContent)).toEqual(["Engineering Managerremove"]);
    const labels = [...(screen.getByTestId("shift-coordinator-delegate-pick") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(labels).toEqual(["Add from your roster…", "licenses", "Reviewer (eng.reviewer)", "Reviewer (ops.reviewer)"]);
  });

  it("adds one from the roster and removes one, each through the coordinator's action on this conversation", async () => {
    render(<DelegatesPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    fireEvent.change(screen.getByTestId("shift-coordinator-delegate-pick"), { target: { value: "licenses" } });
    fireEvent.click(screen.getByTestId("shift-coordinator-delegate-add"));
    await settle();
    expect(screen.getAllByTestId("shift-coordinator-delegate").map((li) => li.getAttribute("data-worker"))).toEqual(["eng.em", "licenses"]);
    fireEvent.click(screen.getAllByTestId("shift-coordinator-delegate-remove")[0]!);
    await settle();
    expect(screen.getAllByTestId("shift-coordinator-delegate").map((li) => li.getAttribute("data-worker"))).toEqual(["licenses"]);
    expect(calls).toEqual(["list coordinator s1", "add coordinator s1 licenses", "remove coordinator s1 eng.em"]);
  });

  it("shows a refused add's reason and keeps the list as it was", async () => {
    refuseAdd = 'No worker "licenses" on your roster.';
    render(<DelegatesPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    fireEvent.change(screen.getByTestId("shift-coordinator-delegate-pick"), { target: { value: "licenses" } });
    fireEvent.click(screen.getByTestId("shift-coordinator-delegate-add"));
    await settle();
    expect(screen.getByTestId("shift-coordinator-delegate-refused").textContent).toContain('No worker "licenses" on your roster.');
    expect(screen.getAllByTestId("shift-coordinator-delegate").map((li) => li.getAttribute("data-worker"))).toEqual(["eng.em"]);
  });
});

describe("a routing record (BR-29)", () => {
  const record = (data: Record<string, unknown>) => ({ type: "component", component: "coordinator-route", data }) as unknown as ComponentItem;

  it("is drawn by its own renderer, as a note apart from the lines", () => {
    expect(shiftManagerRenderers.component?.["coordinator-route"]).toBe(CoordinatorRoute);
    render(
      <CoordinatorRoute
        item={record({
          by: "judgment",
          delegates: [
            { worker: "eng.em", outcome: "delivered" },
            { worker: "eng.coder", outcome: "skipped", reason: 'Worker "eng.coder" runs on flow "coder", which can\'t take a delegated post.' },
          ],
        })}
      />,
    );
    const note = screen.getByTestId("coordinator-route");
    expect(note.getAttribute("data-look")).toBe("route-record");
    expect(note.textContent).toContain("routed · by the coordinator → eng.em");
    expect(screen.getByTestId("coordinator-route-missed").textContent).toContain("eng.coder skipped");
  });
});

describe("a line from another worker, under that worker's name (BR-20, FIX-1989)", () => {
  const known = new Set(["desk.shift-coordinator", "eng.em", "helper"]);
  const helper = toWorker({ id: "helper", kind: "agent", door: "run" })!;

  it("names a delegate's answer on a coordinator, and nobody for the coordinator's own turn", () => {
    expect(senderOf(shiftCoordinator, { agentName: "eng.em" }, known)).toBe("eng.em");
    expect(senderOf(shiftCoordinator, { agentName: "coordinator-judgment" }, known)).toBeUndefined();
    expect(senderOf(shiftCoordinator, {}, known)).toBeUndefined();
  });

  it("names a message's sender on any worker's conversation, never the worker itself or a generator", () => {
    // A worker on the agent flow gets messages too, so its lines are labelled as well.
    expect(senderOf(helper, { agentName: "eng.em" }, known)).toBe("eng.em");
    expect(senderOf(helper, { agentName: "helper" }, known)).toBeUndefined();
    expect(senderOf(helper, { agentName: "agent-answer" }, known)).toBeUndefined();
  });

  it("knows the inventory's workers and every worker a listed session runs", () => {
    const sessions = [{ id: "s1", state: { workerId: "mine.scribe" } }, { id: "s2" }] as unknown as Parameters<typeof knownWorkers>[1];
    expect([...knownWorkers([{ id: "eng.em" }], sessions)].sort()).toEqual(["eng.em", "mine.scribe"]);
  });
});
