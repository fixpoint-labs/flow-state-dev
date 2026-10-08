// @vitest-environment happy-dom
/**
 * The Shift Coordinator as a coordinator (FIX-1791 S10): its delegates panel,
 * its routing records drawn apart from the conversation's lines, and a
 * delegate's answer labelled with the delegate's name.
 *
 * Checks (`specs/issues/FIX-1791/BUSINESS-RULES.md`): BR-33's panel (list,
 * add from the person's roster, remove; a refused add shows its reason and
 * changes nothing), BR-29 (a `coordinator-route` record is never drawn as a
 * line), and BR-20's "under the delegate's name".
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentItem } from "@flow-state-dev/core/items";
import { DelegatesPanel } from "../src/components/DelegatesPanel";
import { CoordinatorRoute } from "../src/components/CoordinatorRoute";
import { shiftManagerRenderers } from "../src/components/ToolLine";
import { delegateOf } from "../src/lib/conversation";
import { toSeat } from "../src/lib/reads";

let listed: Array<{ worker: string; note?: string }> = [];
const calls: string[] = [];
let refuseAdd: string | null = null;

// One connection and one workforce client, as the app memoizes them per Lab.
vi.mock("../src/lib/lab-data", () => {
  const lab = { clients: { userId: "alice" } };
  return { useLab: () => lab };
});
vi.mock("../src/lib/workforce", () => {
  const workforce = {
    roster: async () => [
      { id: "chief-of-staff", flow: "coordinator", standard: true, description: null },
      { id: "eng.em", flow: "em", standard: true, description: null },
      { id: "licenses", flow: "agent", standard: false, description: "Audits licenses." },
    ],
  };
  return { useWorkforce: () => workforce };
});
vi.mock("../src/lib/delegates", () => ({
  readDelegates: async (_c: unknown, kind: string, sessionId: string) => {
    calls.push(`list ${kind} ${sessionId}`);
    return { delegates: [...listed], max: 25 };
  },
  addDelegate: async (_c: unknown, kind: string, sessionId: string, worker: string) => {
    calls.push(`add ${kind} ${sessionId} ${worker}`);
    if (refuseAdd !== null) throw new Error(refuseAdd);
    listed = [...listed, { worker }];
    return { delegates: [...listed], max: 25 };
  },
  removeDelegate: async (_c: unknown, kind: string, sessionId: string, worker: string) => {
    calls.push(`remove ${kind} ${sessionId} ${worker}`);
    listed = listed.filter((d) => d.worker !== worker);
    return { delegates: [...listed], max: 25 };
  },
}));

const cos = toSeat({ id: "chief-of-staff", kind: "coordinator", door: "run" })!;

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
    render(<DelegatesPanel seat={cos} sessionId={null} />);
    await settle();
    expect(screen.getByTestId("cos-delegates-none")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("lists the conversation's delegates, and offers the person's roster minus the coordinator and those listed", async () => {
    render(<DelegatesPanel seat={cos} sessionId="s1" />);
    await settle();
    expect(calls).toEqual(["list coordinator s1"]);
    expect(screen.getAllByTestId("cos-delegate").map((li) => li.getAttribute("data-worker"))).toEqual(["eng.em"]);
    const options = [...(screen.getByTestId("cos-delegate-pick") as HTMLSelectElement).options].map((o) => o.value);
    expect(options).toEqual(["", "licenses"]);
  });

  it("adds one from the roster and removes one, each through the coordinator's action on this conversation", async () => {
    render(<DelegatesPanel seat={cos} sessionId="s1" />);
    await settle();
    fireEvent.change(screen.getByTestId("cos-delegate-pick"), { target: { value: "licenses" } });
    fireEvent.click(screen.getByTestId("cos-delegate-add"));
    await settle();
    expect(screen.getAllByTestId("cos-delegate").map((li) => li.getAttribute("data-worker"))).toEqual(["eng.em", "licenses"]);
    fireEvent.click(screen.getAllByTestId("cos-delegate-remove")[0]!);
    await settle();
    expect(screen.getAllByTestId("cos-delegate").map((li) => li.getAttribute("data-worker"))).toEqual(["licenses"]);
    expect(calls).toEqual(["list coordinator s1", "add coordinator s1 licenses", "remove coordinator s1 eng.em"]);
  });

  it("shows a refused add's reason and keeps the list as it was", async () => {
    refuseAdd = 'No worker "licenses" on your roster.';
    render(<DelegatesPanel seat={cos} sessionId="s1" />);
    await settle();
    fireEvent.change(screen.getByTestId("cos-delegate-pick"), { target: { value: "licenses" } });
    fireEvent.click(screen.getByTestId("cos-delegate-add"));
    await settle();
    expect(screen.getByTestId("cos-delegate-refused").textContent).toContain('No worker "licenses" on your roster.');
    expect(screen.getAllByTestId("cos-delegate").map((li) => li.getAttribute("data-worker"))).toEqual(["eng.em"]);
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

describe("a delegate's answer, under the delegate's name (BR-20)", () => {
  it("names the delegate on a coordinator, and nobody for the coordinator's own turn or any other seat", () => {
    expect(delegateOf(cos, { agentName: "eng.em" })).toBe("eng.em");
    expect(delegateOf(cos, { agentName: "coordinator-judgment" })).toBeUndefined();
    expect(delegateOf(cos, {})).toBeUndefined();
    expect(delegateOf(toSeat({ id: "helper", kind: "agent", door: "run" })!, { agentName: "eng.em" })).toBeUndefined();
  });
});
