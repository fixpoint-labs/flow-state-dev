// @vitest-environment happy-dom
/**
 * What a seat opened in the rail reads, by the kind of address it has.
 *
 * Only a seat hired into the whole organization has a public roster row, and
 * its row is keyed by the seat id inside its address. A seat declared in a
 * worker file has no row; a seat a user hired for themselves has a row the
 * rail may not read, and its short id can equal an org-visible seat's.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1500/PLAN.md`), and the red
 * state each was seen in before its green was trusted:
 *
 *   V17 A user-owned seat, `<org>.~<user>.<id>`, whose short id matches an
 *       org-visible seat's, opens as "not published" and reads nothing. Red:
 *       derive the topic with `splitSeatAddress` alone, which skips the user
 *       segment — the pane reads `support.pat` and shows the other seat's
 *       instructions.
 *   The org-visible case reads exactly one item, under the roster key the
 *   hire writes. Red: pass no `collectionRef` — the read goes to `roster`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import { FlowProvider, type PanelItemSource } from "@flow-state-dev/react";
import { HIRED_ROSTER_RESOURCE } from "@flow-state-dev/workforce";

import { SeatPane } from "../components/seat-pane";

const ORG = "kitchen-sink";

afterEach(cleanup);

/** A resource client holding one org-visible seat, `support.pat`, that records every read. */
function rosterWithPat() {
  const reads: Array<[ref: string, topic: string]> = [];
  const client: PanelItemSource = {
    getCollectionItemState: async (_sessionId, ref, topic) => {
      reads.push([ref, topic]);
      if (ref !== HIRED_ROSTER_RESOURCE || topic !== "support.pat") return null;
      return {
        topic,
        clientData: { seatId: "support.pat", flow: "agent", instructions: "Handles the org's refunds." },
      } as unknown as Awaited<ReturnType<PanelItemSource["getCollectionItemState"]>>;
    },
  };
  return { client, reads };
}

function open(address: string, client: PanelItemSource): HTMLElement {
  const { container } = render(
    <FlowProvider flowKind="chat-agent" userId="devuser" baseUrl="http://test">
      <SeatPane
        sessionId="s-1"
        orgId={ORG}
        kind="agent"
        address={address}
        resourceClient={client}
        hireSessionId={async () => "hire-session"}
        onHired={() => {}}
      />
    </FlowProvider>,
  );
  return container;
}

/** Let any read the pane started come back before asserting on what it did not do. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("a seat opened in the rail", () => {
  it("V17 · a user-owned seat sharing an org seat's short id is not published, and reads nothing", async () => {
    const { client, reads } = rosterWithPat();
    const pane = open(`${ORG}.~workforce-admin.support.pat`, client);
    await settle();

    expect(within(pane).getByText("agent")).toBeTruthy();
    expect(pane.querySelector('[data-state="not-published"]')).not.toBeNull();
    expect(pane.textContent).not.toContain("Handles the org's refunds.");
    expect(reads).toEqual([]);
  });

  it("a seat hired into the organization reads its one roster row and shows its instructions", async () => {
    const { client, reads } = rosterWithPat();
    const pane = open(`${ORG}.support.pat`, client);

    await waitFor(() => expect(pane.querySelector('[data-state="text"]')?.textContent).toBe("Handles the org's refunds."));
    expect(reads).toEqual([[HIRED_ROSTER_RESOURCE, "support.pat"]]);
  });

  it("a seat declared in a worker file is not published, and reads nothing", async () => {
    const { client, reads } = rosterWithPat();
    const pane = open("support.iris", client);
    await settle();

    expect(pane.querySelector('[data-state="not-published"]')).not.toBeNull();
    expect(reads).toEqual([]);
  });
});
