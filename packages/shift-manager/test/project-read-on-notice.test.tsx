// @vitest-environment happy-dom
/**
 * A project's entries read on a change, not every 5 s: the view reads the
 * project and its workstream entries when it opens, again on a notice of either under
 * the project's scope (the org's for a shared project, the user's for a
 * private one) and on each Lab read (`readAt`), and on nothing else while push
 * covers the page. Wherever push can miss a change, the subscription keeps the
 * old 5 s pace. A failed later read keeps the last rows; only a failed first
 * read shows.
 *
 * The client's own live read rides a subscription the test drives.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WireNotice, WireTopic } from "@flow-state-dev/client";
import { liveRead } from "@flow-state-dev/client/internal";

type Opened = { topics: readonly WireTopic[]; pollIntervalMs?: number; onChange: (notice: WireNotice | null) => void; closed: boolean };
const opened: Opened[] = [];
const subscribe = (topics: readonly WireTopic[], options: { onChange: (notice: WireNotice | null) => void; pollIntervalMs?: number }) => {
  const entry: Opened = { topics, pollIntervalMs: options.pollIntervalMs, onChange: options.onChange, closed: false };
  opened.push(entry);
  return { close: () => void (entry.closed = true) };
};
const hear = (notice: WireNotice) => opened.filter((o) => !o.closed).forEach((o) => o.onChange(notice));

let title = "Apollo";
let failing = false;
let projectReads = 0;
const client = {
  userId: "u_1",
  resources: {
    getCollectionResourceState: async () => {
      projectReads += 1;
      if (failing) throw new Error("unavailable");
      return { clientData: { id: "apollo", title, ownerUserId: "u_1" } };
    },
    listCollectionResources: async () => ({ items: [] }),
  },
  live: (topics: readonly WireTopic[], options: Parameters<typeof liveRead>[2]) => liveRead(subscribe as never, topics, options),
};
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client }) }));

import { useProjectRead, type ProjectAddress } from "../src/lib/projects";

type Shown = ReturnType<typeof useProjectRead>["read"];
const shown: Shown[] = [];
function Probe({ address, readAt }: { address: ProjectAddress; readAt: number }) {
  const { read } = useProjectRead(address, "s_reader", readAt);
  shown.push(read);
  return null;
}
const titleShown = () => {
  const last = shown.at(-1);
  return last !== undefined && "value" in last ? last.value?.project.title : undefined;
};
const settle = () => new Promise((r) => setTimeout(r, 50));
const resource = (scope: "user" | "org", path: string): WireNotice => ({ topic: { scope, resource: path }, kind: "resource" });

beforeEach(() => {
  opened.splice(0);
  shown.splice(0);
  title = "Apollo";
  failing = false;
  projectReads = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a project's entries", () => {
  it("read on open, then only on a notice of the project or its entries under its scope and on a Lab read; at the old pace where push can miss one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = render(<Probe address={{ visibility: "shared", id: "apollo" }} readAt={1} />);
    await waitFor(() => expect(titleShown()).toBe("Apollo"));

    // Push covers the page: nothing on a clock, and nothing for another project or another collection.
    await vi.advanceTimersByTimeAsync(12_000);
    hear(resource("org", "projects/zeus"));
    hear(resource("org", "workstreams/zeus/u_1/research"));
    hear(resource("org", "inventory/workers/eng"));
    await settle();
    expect(projectReads).toBe(1);
    const sub = opened.find((o) => !o.closed);
    expect(sub?.topics).toEqual([{ scope: "org" }]);
    expect(sub?.pollIntervalMs).toBe(5_000);

    title = "Apollo, renamed";
    hear(resource("org", "workstreams/apollo/u_2/search"));
    await waitFor(() => expect(titleShown()).toBe("Apollo, renamed"));
    expect(projectReads).toBe(2);
    hear(resource("org", "projects/apollo"));
    await waitFor(() => expect(projectReads).toBe(3));

    view.rerender(<Probe address={{ visibility: "shared", id: "apollo" }} readAt={2} />);
    await waitFor(() => expect(projectReads).toBe(4));
  });

  it("of a private project are heard under the user's scope", async () => {
    render(<Probe address={{ visibility: "private", id: "apollo" }} readAt={1} />);
    await waitFor(() => expect(titleShown()).toBe("Apollo"));
    expect(opened.find((o) => !o.closed)?.topics).toEqual([{ scope: "user" }]);
  });

  it("keep the last rows when a later read fails; only a failed first read shows", async () => {
    failing = true;
    render(<Probe address={{ visibility: "shared", id: "apollo" }} readAt={1} />);
    await waitFor(() => expect(shown.at(-1)).toHaveProperty("failure"));

    failing = false;
    hear(resource("org", "workstreams/apollo/u_1/research"));
    await waitFor(() => expect(titleShown()).toBe("Apollo"));

    failing = true;
    const before = projectReads;
    hear(resource("org", "projects/apollo"));
    await waitFor(() => expect(projectReads).toBe(before + 1));
    await settle();
    expect(titleShown()).toBe("Apollo");
  });
});
