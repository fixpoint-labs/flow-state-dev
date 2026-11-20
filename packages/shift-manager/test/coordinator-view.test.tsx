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
import { act, cleanup, fireEvent, render as draw, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataItem } from "@flow-state-dev/core/items";
import { DelegatesPanel } from "../src/components/DelegatesPanel";
import { DirectoryProvider } from "../src/lib/directory";

const render = (ui: ReactElement) => draw(ui, { wrapper: DirectoryProvider });
import { CoordinatorRoute } from "../src/components/CoordinatorRoute";
import { shiftManagerRenderers } from "../src/components/ToolLine";
import { knownWorkers, senderOf } from "../src/lib/conversation";
import { toWorker } from "../src/lib/workers";

let listed: Array<{ worker: string; note?: string }> = [];
const calls: string[] = [];
let refuseAdd: string | null = null;
const rosterViews = new Set<(entries: unknown[]) => void>();
/** The session's delegate list changed: every watch of the delegates view hears it, as the server pushes it. */
const changed = new Set<() => void>();
const changeList = (next: Array<{ worker: string; note?: string }>) => {
  listed = next;
  for (const heard of [...changed]) heard();
};

// FIX-2775: the directory, holding the page's one roster watch: nothing else read.
vi.mock("../src/lib/directory-reads", async () => {
  const { useFixtureReads } = await import("./helpers/directory");
  return { useDirectoryReads: () => useFixtureReads(() => undefined) };
});
// One connection and one workforce client, as the app memoizes them per Lab.
vi.mock("../src/lib/lab-data", () => {
  const lab = { client: { userId: "alice" } };
  return { useLab: () => lab };
});
vi.mock("../src/lib/workforce", () => {
  const workforce = {
    organization: async () => "acme",
    // The roster watch: reports one read, and each roster a test tells it of.
    watchRoster(onRoster: (entries: unknown[]) => void) {
      rosterViews.add(onRoster);
      void this.roster().then(onRoster);
      return () => rosterViews.delete(onRoster);
    },
    addDelegate: async (sessionId: string, worker: string) => {
      calls.push(`add ${sessionId} ${worker}`);
      if (refuseAdd !== null) throw new Error(refuseAdd);
      changeList([...listed, { worker }]);
    },
    removeDelegate: async (sessionId: string, worker: string) => {
      calls.push(`remove ${sessionId} ${worker}`);
      changeList(listed.filter((d) => d.worker !== worker));
    },
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
// The delegates view (`delegatesViewRef`, through `useView`): one read per watch, then each change pushed.
vi.mock("@flow-state-dev/react", async (original) => {
  const { useEffect, useState } = await import("react");
  return {
    ...(await original<typeof import("@flow-state-dev/react")>()),
    useView: (ref: { flow: string; view: string }, _input: unknown, options: { enabled?: boolean; sessionId?: string }) => {
      const [, bump] = useState(0);
      const on = options.enabled !== false && ref.view === "delegates";
      useEffect(() => {
        if (!on) return;
        calls.push(`view ${ref.flow} ${options.sessionId}`);
        const heard = () => bump((n) => n + 1);
        changed.add(heard);
        return () => void changed.delete(heard);
      }, [on, ref.flow, options.sessionId]);
      return { value: on ? { delegates: [...listed], max: 25, fallback: null, filingSessionId: "f" } : undefined, stale: false };
    },
  };
});

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
    expect(calls).toEqual(["view coordinator s1"]);
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

  it("adds one from the roster and removes one, each through workforce's call on this conversation", async () => {
    render(<DelegatesPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    fireEvent.change(screen.getByTestId("shift-coordinator-delegate-pick"), { target: { value: "licenses" } });
    fireEvent.click(screen.getByTestId("shift-coordinator-delegate-add"));
    await settle();
    expect(screen.getAllByTestId("shift-coordinator-delegate").map((li) => li.getAttribute("data-worker"))).toEqual(["eng.em", "licenses"]);
    fireEvent.click(screen.getAllByTestId("shift-coordinator-delegate-remove")[0]!);
    await settle();
    expect(screen.getAllByTestId("shift-coordinator-delegate").map((li) => li.getAttribute("data-worker"))).toEqual(["licenses"]);
    expect(calls).toEqual(["view coordinator s1", "add s1 licenses", "remove s1 eng.em"]);
  });

  it("offers a worker the roster watch reports, with no remount and no new read of the delegates", async () => {
    render(<DelegatesPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    await act(async () => {
      for (const view of [...rosterViews]) {
        view([
          { id: "shift-coordinator", flow: "coordinator", standard: true, description: null },
          { id: "eng.em", flow: "em", standard: true, description: null, name: "Engineering Manager" },
          { id: "scribe", flow: "agent", standard: false, description: null, name: null },
        ]);
      }
    });
    const options = [...(screen.getByTestId("shift-coordinator-delegate-pick") as HTMLSelectElement).options].map((o) => o.value);
    expect(options).toEqual(["", "scribe"]);
    expect(calls).toEqual(["view coordinator s1"]);
  });

  // FIX-2776 D1: the panel watched an action's answer before, and missed what the coordinator's own tool changed.
  it("shows an add the coordinator's own tool made, as it lands, with no remount and no new read", async () => {
    render(<DelegatesPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    await act(async () => changeList([...listed, { worker: "eng.reviewer" }]));
    expect(screen.getAllByTestId("shift-coordinator-delegate").map((li) => li.getAttribute("data-worker"))).toEqual(["eng.em", "eng.reviewer"]);
    expect(calls).toEqual(["view coordinator s1"]);
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
  const record = (value: Record<string, unknown>) => ({ type: "data", dataType: "coordinator-route", value }) as unknown as DataItem;

  it("is drawn by its own renderer, as a note apart from the lines", () => {
    expect(shiftManagerRenderers.data?.["coordinator-route"]).toBe(CoordinatorRoute);
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

  // FIX-2488: a reply the coordinator answered itself was footed with
  // "routed · by the coordinator · the coordinator handed it to no delegate",
  // which reads as routing that never happened. The record says so with
  // `answeredItself`, so no note is drawn. Read from that flag, never from the
  // `none` wording.
  it("draws nothing for a reply the coordinator answered itself", () => {
    const { container } = render(
      <CoordinatorRoute
        item={record({ by: "judgment", delegates: [], none: "the coordinator handed it to no delegate", answeredItself: true })}
      />,
    );
    expect(screen.queryByTestId("coordinator-route")).toBeNull();
    expect(container.textContent).not.toContain("handed it to no delegate");
  });

  it("still names who missed when the coordinator tried a delegate and none took it", () => {
    render(
      <CoordinatorRoute
        item={record({
          by: "judgment",
          delegates: [{ worker: "eng.coder", outcome: "failed", reason: "unreachable" }],
          none: "the coordinator handed it to no delegate",
        })}
      />,
    );
    expect(screen.getByTestId("coordinator-route")).toBeTruthy();
    expect(screen.getByTestId("coordinator-route-missed").textContent).toContain("eng.coder failed: unreachable");
  });

  it("keeps the note on a round whose delegates never answered, which is why the conversation stopped", () => {
    render(<CoordinatorRoute item={record({ by: "judgment", round: 1, delegates: [], none: "no delegate answered in round 0" })} />);
    expect(screen.getByTestId("coordinator-route").textContent).toContain("routed · by the coordinator · no delegate answered in round 0");
  });

  it("keeps a fixed policy's no-delegate reason, which is the answer to where the post went", () => {
    render(<CoordinatorRoute item={record({ by: "unplaced", delegates: [], none: "no delegate can take a task" })} />);
    expect(screen.getByTestId("coordinator-route").textContent).toContain("routed · nobody · no delegate can take a task");
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
