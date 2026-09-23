// @vitest-environment happy-dom
/**
 * The skipped seats a boot could not bring back, on screen in the roster
 * panel of the organization they belong to.
 *
 * The boot here is the real one minus the module it lives in: the real
 * `reloadHiredSeats` over rows in a real in-memory store, then the same
 * `admitReloadedSeats` `fsdev.config.ts` calls, with a registrar that can be
 * told to refuse a seat. The panel is the shell's own `TeamPanel`, reading
 * through the engine's collection routes as a browser would. Assertions are on
 * the rendered DOM, so they hold whatever shape the report takes in between.
 *
 * `acme` holds two failures of different origin: a row the reload cannot turn
 * into a seat, and a seat that loads and is then refused at registration.
 * `beta` holds one good seat and no failure.
 *
 * Red states produced before these were trusted:
 *   - admit refusals into the flat list only, not the org's report: (b) fails
 *     and (a), (c), (d) stay green.
 *   - write every org's report from the flat problem list: (c) fails.
 *   - skip the write for an org with no problems: (d) fails, because boot
 *     one's report is still standing.
 *   - never write the report at all: V14 fails with the roster showing a
 *     clean list.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createResourceClient } from "@flow-state-dev/client";
import { FlowProvider } from "@flow-state-dev/react";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { reloadHiredSeats } from "@flow-state-dev/workforce";

import { TeamPanel } from "../components/team-panel";
import { workforcePanelResources } from "../flows/chat-agent/shared/workforce-panels";
import { admitReloadedSeats } from "../lib/roster-reload-report";
import { ROSTER_BOOT_REPORT_REF } from "../lib/workforce-shell";
import { kitchenSinkKinds } from "../workforce/hire";

const FLOW_KIND = "shell-panels";
const ORGS = ["acme", "beta"];

/** The shell's panel declarations, on a flow whose sessions bind a verified org. */
const panelFlow = defineFlow({
  kind: FLOW_KIND,
  resources: workforcePanelResources,
  actions: {
    noop: {
      inputSchema: z.object({}),
      block: handler({
        name: "noop",
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        execute: async () => ({}),
      }),
    },
  },
  authentication: {
    resolvePrincipal: (context) => {
      const org = context.request?.headers.get("x-verified-org");
      return org == null ? null : { userId: `user-of-${org}`, orgId: org };
    },
  },
});

function seatRow(seatId: string, flow: string) {
  return { seatId, flow, settings: {}, instructions: null, owningOrgId: null, ownerUserId: null };
}

async function harness() {
  const state = createFlowState({
    flows: { [FLOW_KIND]: panelFlow() },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
  });
  const runtime = await state.getRuntime();
  const router = (await state.getRouter()) as Record<
    string,
    (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>
  >;

  /** A browser's fetch, pointed at the router, carrying one org's credential. */
  const fetcherFor = (org: string, reportReads: string[], failReport = false) =>
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), "http://test");
      const path = url.pathname
        .replace(/^\/api\/flows\/?/, "")
        .split("/")
        .filter((segment) => segment.length > 0)
        .map(decodeURIComponent);
      const method = (init?.method ?? "GET").toUpperCase();
      if (failReport && path.at(-1) === ROSTER_BOOT_REPORT_REF) {
        reportReads.push(org);
        return new Response(JSON.stringify({ error: "store unavailable" }), { status: 503 });
      }
      const headers = new Headers(init?.headers);
      headers.set("x-verified-org", org);
      const response = await router[method]!(new Request(url, { ...init, headers }), {
        params: { path },
      });
      if (path.at(-1) === ROSTER_BOOT_REPORT_REF) reportReads.push(org);
      return response;
    };

  async function openSession(org: string): Promise<string> {
    const response = await router.POST!(
      new Request(`http://test/api/flows/${FLOW_KIND}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-verified-org": org },
        body: JSON.stringify({ userId: `user-of-${org}` }),
      }),
      { params: { path: [FLOW_KIND, "sessions"] } },
    );
    const json = (await response.json()) as { session?: { id: string }; id?: string };
    const id = json.session?.id ?? json.id;
    if (id === undefined) throw new Error(`no session: ${JSON.stringify(json)}`);
    return id;
  }

  /** One boot: the reload, then admission through a registrar that may refuse. */
  async function boot(refuse: ReadonlySet<string>) {
    const reload = await reloadHiredSeats({
      stores: runtime.stores,
      orgIds: ORGS,
      kinds: kitchenSinkKinds,
    });
    await admitReloadedSeats({
      reload,
      stores: runtime.stores,
      admit: (seat: FlowInstance) => {
        if (refuse.has(seat.id)) throw new Error("the registry refused this address");
      },
    });
  }

  /** The panel as the given org's member sees it, once the report has been read. */
  async function panelFor(org: string, options: { failReport?: boolean } = {}): Promise<HTMLElement> {
    const sessionId = await openSession(org);
    const reportReads: string[] = [];
    const client = createResourceClient({
      baseUrl: "http://test",
      fetcher: fetcherFor(org, reportReads, options.failReport),
    });
    const { container } = render(
      <FlowProvider flowKind={FLOW_KIND} userId={`user-of-${org}`} baseUrl="http://test">
        <TeamPanel sessionId={sessionId} resourceClient={client} />
      </FlowProvider>,
    );
    const panel = within(container).getByTestId("roster-panel").parentElement!;
    // Not settled until BOTH reads are back: the seats, and the report. An
    // assertion that the problems are absent means nothing before the report
    // has been read.
    await waitFor(() => {
      expect(panel.querySelector("[data-roster-seats]")).not.toBeNull();
      expect(reportReads).toContain(org);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return panel;
  }

  return { stores: runtime.stores, boot, panelFor };
}

afterEach(cleanup);

describe("V14 · a skipped seat is on screen, beside the seats", () => {
  it("shows the seats and the skipped seat with its reason", async () => {
    const h = await harness();
    await h.stores.resourceState.set("org", "acme", "workforce/roster/support.ada", seatRow("support.ada", "agent"), "any");
    await h.stores.resourceState.set("org", "acme", "workforce/roster/support.bo", seatRow("support.bo", "kind-that-is-gone"), "any");
    await h.boot(new Set());

    const panel = await h.panelFor("acme");
    expect(panel.querySelector("[data-seat-id='support.ada']")).not.toBeNull();
    expect(panel.querySelector("[data-roster-problems]")).not.toBeNull();
    expect(panel.textContent).toContain("could not be loaded");
    expect(panel.textContent).toContain("kind-that-is-gone");
  });
});

describe("V15 · two organizations, two boots, one report each", () => {
  it("files each failure under its own org, and clears it on the next clean boot", async () => {
    const h = await harness();
    const set = (org: string, seatId: string, flow: string) =>
      h.stores.resourceState.set("org", org, `workforce/roster/${seatId}`, seatRow(seatId, flow), "any");

    // acme: a row that fails to load, and a seat that loads and is refused.
    await set("acme", "support.bo", "kind-that-is-gone");
    await set("acme", "support.cy", "agent");
    // beta: one good seat, nothing wrong.
    await set("beta", "support.ada", "agent");

    await h.boot(new Set(["acme.support.cy"]));

    const acme = await h.panelFor("acme");
    // Soft, so a red run reports every one of (a)–(d) that failed rather than
    // stopping at the first: each excludes one failure the others cannot.
    // (a) the load failure
    expect.soft(acme.textContent, "(a)").toContain('row "workforce/roster/support.bo"');
    // (b) the registration refusal
    expect.soft(acme.textContent, "(b)").toContain("acme.support.cy — the registry refused this address");

    // (c) beta names no problems, having read its report and drawn its seat
    const beta = await h.panelFor("beta");
    expect(beta.querySelector("[data-seat-id='support.ada']")).not.toBeNull();
    expect.soft(beta.querySelector("[data-roster-problems]"), "(c)").toBeNull();
    expect.soft(beta.textContent, "(c)").not.toContain("acme");
    cleanup();

    // Boot two, with both of acme's causes removed: the row repaired, and the
    // address that refused the other seat freed.
    await set("acme", "support.bo", "agent");
    await h.boot(new Set());

    // (d) acme names no problems
    const acmeAgain = await h.panelFor("acme");
    expect(acmeAgain.querySelector("[data-seat-id='support.bo']")).not.toBeNull();
    expect.soft(acmeAgain.querySelector("[data-roster-problems]"), "(d)").toBeNull();
  });
});

describe("a boot report that cannot be read", () => {
  it("says so on its own line, and does not count as a skipped seat", async () => {
    const h = await harness();
    await h.stores.resourceState.set("org", "acme", "workforce/roster/support.ada", seatRow("support.ada", "agent"), "any");
    await h.boot(new Set());

    const panel = await h.panelFor("acme", { failReport: true });
    expect(panel.textContent).toContain("could not be read");
    // Counting the failure as a seat would report one skipped seat that does
    // not exist.
    expect(panel.querySelector("[data-roster-problems]")).toBeNull();
    expect(panel.querySelector("[data-seat-id='support.ada']")).not.toBeNull();
  });
});
