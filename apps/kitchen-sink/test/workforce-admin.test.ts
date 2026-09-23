/**
 * `workforce-admin` — the hire and fire refusals, driven through the real
 * `runAction` engine against in-memory stores.
 *
 * Each case names what would make it fail. The red states were produced and
 * reverted before the greens here were trusted:
 *
 *   V9  — register the admin flow unconditionally: the fail-closed assertion
 *         passes trivially and a default deployment has a hire path.
 *   V10 — return the org from the envelope instead of the token: the resolver
 *         hands back "bravo" for acme's credential.
 *   V11 — for the ordinary duplicate, remove the address pre-check: the second
 *         hire reaches the row write, and `create()` refuses it there instead
 *         of the refusal naming what holds the address.
 *         **`upsert()` does NOT turn this case red, and that is worth knowing
 *         rather than assuming**: when the first hire registered, the address
 *         pre-check refuses the second one before any write happens, so the
 *         write verb is never reached. The two cases below that DO reach it —
 *         a stranded row with a free address, and two hires at once — are the
 *         ones where `create()` is load-bearing, and both go red under
 *         `upsert()`.
 *   V12 — read-then-write, or `upsert()`, instead of `create()`: both
 *         concurrent hires resolve and the last write wins.
 *   V13 — remove the compensating delete: a hire whose registration failed
 *         leaves a live row, so the seat appears at the next boot although the
 *         caller was told the hire failed.
 *   V15 — unregister by address alone: the foreign instance goes offline.
 *
 *   V9b — bind tokens with `byToken.set(token, org)`: with
 *         `acme:secret,bravo:secret` the later write silently wins, so acme's
 *         own credential resolves the BRAVO organization. Produced: the
 *         principal came back as `bravo`.
 *   V11 (settings shadow) — spread the row as `{ flow, ...settings }` in
 *         `packages/workforce/src/roster/rows.ts`: the hire is ACCEPTED and
 *         registers an `agent` under a row that says `desk-clerk`, and the
 *         fire that follows deletes the row and leaves it registered
 *         (`released: false`).
 *   V15b — gate `fire` on `liveKind !== storedKind` alone: a file-declared
 *         seat carrying the row's OWN kind is unregistered (`released: true`).
 *
 * `fire` releases an address only when BOTH clauses hold — this app registered
 * it from a roster row, AND the live kind still matches the stored one.
 * Neither subsumes the other, and V15b and V15 are the two red states that say
 * so: drop the provenance clause and V15b fails, drop the kind clause and V15
 * fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import {
  ADMIN_TOKENS_ENV,
  adminCredentialConfigured,
  adminPrincipalResolver,
} from "../lib/workforce-admin-auth";
import {
  setWorkforceRegistrarImpl,
  workforceRegistrar,
  type WorkforceRegistrar,
} from "../lib/workforce-registrar";
import workforceAdminFlow from "../flows/workforce-admin/flow";

const modelResolver = createMockModelResolver({ policy: "allow" });

const ORG = "acme";
const OTHER_ORG = "bravo";

/** A registrar stub that records what was admitted, and can be made to refuse. */
function stubRegistrar(options: { refuse?: boolean } = {}) {
  const held = new Map<string, FlowInstance>();
  const impl: WorkforceRegistrar & { held: Map<string, FlowInstance> } = {
    held,
    register: (flow) => {
      if (options.refuse === true) throw new Error("the registry refused this seat");
      held.set(flow.id, flow);
    },
    unregister: (id) => held.delete(id),
    kindAt: (id) => held.get(id)?.kind,
  };
  setWorkforceRegistrarImpl(impl);
  return impl;
}

/**
 * The admin flow instance.
 *
 * Imported statically, and `vi.resetModules()` is deliberately NOT used. A
 * reset forks the module graph, so the flow would close over a *different*
 * copy of `lib/workforce-registrar` than `stubRegistrar` installs into — which
 * is how every successful hire in this file first failed with "the workforce
 * registrar has not been installed". The flow's own resolver is never
 * exercised through `runAction` (that is transport-level), so it does not
 * matter that the module evaluated before the env was stubbed.
 *
 * Two different lifetimes are in play here, and only one of them is what V9
 * and V10 exercise. Calling `adminPrincipalResolver()` directly — which is
 * what V9 and V10 do — re-reads the env on that call, so stubbing the env
 * first and calling it after sees the stub. The resolver `flow.ts` actually
 * wires in (`resolvePrincipal: adminPrincipalResolver()`) is called once, at
 * module evaluation, and closes over whatever the env held at that moment;
 * changing the env afterwards does not reach an already-imported flow.
 */
function adminFlow(): FlowInstance {
  return workforceAdminFlow as FlowInstance;
}

/**
 * One admin action, through the real engine.
 *
 * The outcome is read off `ExecutionResult.error` rather than a status string.
 * That distinction is load-bearing and was found by this file failing: `runAction`
 * returns no `status` field at all, so an assertion like
 * `expect(result.status).not.toBe("completed")` is satisfied by `undefined` and
 * passes against an implementation that refuses nothing.
 */
async function callAdmin(
  flow: FlowInstance,
  stores: ReturnType<typeof createInMemoryStores>,
  actionName: "hire" | "fire",
  input: unknown,
  orgId: string = ORG
) {
  return runAction({
    flow,
    actionName,
    input,
    userId: "admin",
    orgId,
    stores,
    runtimeConfig: { modelResolver },
  });
}

/** Assert the call succeeded, naming the error when it did not. */
function expectAccepted(result: { error?: { message?: string } }): void {
  expect(result.error?.message ?? null).toBe(null);
}

/** Assert the call was refused, and that the refusal says why. */
function expectRefused(result: { error?: { message?: string } }, because: RegExp): void {
  expect(result.error).toBeDefined();
  expect(result.error?.message ?? "").toMatch(because);
}

/** The stored roster row for one seat, read straight out of the store. */
async function storedRow(
  stores: ReturnType<typeof createInMemoryStores>,
  seatId: string,
  orgId: string = ORG
): Promise<Record<string, unknown> | undefined> {
  const rows = await stores.resourceState.getByPrefix("org", orgId, "workforce/roster/");
  const match = Object.values(rows).find((row) => row.state.seatId === seatId);
  return match?.state as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.stubEnv(ADMIN_TOKENS_ENV, `${ORG}:tok-acme,${OTHER_ORG}:tok-bravo`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("V9 · the admin door is fail-closed", () => {
  it("has no credential and therefore no resolver when the env is unset", () => {
    vi.stubEnv(ADMIN_TOKENS_ENV, "");
    expect(adminCredentialConfigured()).toBe(false);
    // `undefined` is what makes `fsdev.config.ts` leave the flow out of the
    // `flows` map entirely. Registering it unconditionally and checking the
    // credential inside the action would put a hire path on every default
    // deployment, guarded by a check somebody could get wrong.
    expect(adminPrincipalResolver()).toBeUndefined();
  });

  it("refuses a request carrying no credential, and one carrying a wrong credential", () => {
    const resolve = adminPrincipalResolver();
    expect(resolve).toBeDefined();
    const envelope = { flowKind: "workforce-admin", action: "hire", input: {} };

    expect(() =>
      resolve!({ source: "http", request: new Request("http://x"), envelope })
    ).toThrow(/admin credential/i);

    expect(() =>
      resolve!({
        source: "http",
        request: new Request("http://x", { headers: { authorization: "Bearer nope" } }),
        envelope,
      })
    ).toThrow(/Invalid/i);
  });
});

describe("V9b · a token two organizations share resolves neither", () => {
  it("drops BOTH bindings rather than letting config order pick a tenant", () => {
    // `byToken.set(token, org)` keeps the last write and discards the first
    // silently, so with a shared secret acme's own admin credential resolves
    // the BRAVO organization — a cross-tenant authorization decision made by
    // the order two entries are written in. Dropping only the later binding
    // would still leave acme's operator holding a credential bravo knows.
    //
    // Red state: go back to `byToken.set(...)` per entry. `resolve` is defined
    // (the map has one live entry), and the principal comes back as bravo.
    vi.stubEnv(ADMIN_TOKENS_ENV, `${ORG}:shared,${OTHER_ORG}:shared`);

    // The only token collided, so nothing is configured — which is what makes
    // `fsdev.config.ts` leave the admin flow out of the `flows` map entirely.
    expect(adminCredentialConfigured()).toBe(false);
    expect(adminPrincipalResolver()).toBeUndefined();
  });

  it("leaves an uncollided token working, and refuses the shared one", async () => {
    vi.stubEnv(ADMIN_TOKENS_ENV, `${ORG}:shared,${OTHER_ORG}:shared,carol:tok-carol`);
    const resolve = adminPrincipalResolver();
    expect(resolve).toBeDefined();

    const envelope = { flowKind: "workforce-admin", action: "hire", input: {} };
    const withToken = (token: string) => ({
      source: "http" as const,
      request: new Request("http://x", { headers: { authorization: `Bearer ${token}` } }),
      envelope,
    });

    // Neither org the shared secret named — not the first, not the last.
    expect(() => resolve!(withToken("shared"))).toThrow(/Invalid/i);
    expect(await resolve!(withToken("tok-carol"))).toMatchObject({ orgId: "carol" });
  });

  it("treats one organization written twice under one token as one binding", () => {
    // Not a collision: it is the same binding spelled twice, and failing it
    // closed would refuse a config that names exactly one tenant.
    vi.stubEnv(ADMIN_TOKENS_ENV, `${ORG}:tok-acme,${ORG}:tok-acme`);
    expect(adminCredentialConfigured()).toBe(true);
  });
});

describe("V10 · the organization comes from the credential, never the body", () => {
  it("returns acme for acme's token even when the request body names bravo", async () => {
    const resolve = adminPrincipalResolver()!;
    const principal = await resolve({
      source: "http",
      request: new Request("http://x", { headers: { authorization: "Bearer tok-acme" } }),
      // The body says bravo. The stock resolver would believe it — that is the
      // BP-031 hole this flow's own resolver exists to close.
      envelope: {
        flowKind: "workforce-admin",
        action: "hire",
        input: { orgId: OTHER_ORG, seatId: "support.ada", flow: "desk-clerk" },
      },
    });
    expect(principal).toEqual({ userId: "workforce-admin", orgId: ORG });
  });

  it("returns bravo for bravo's token — so the mapping is read, not hard-coded", async () => {
    const resolve = adminPrincipalResolver()!;
    const principal = await resolve({
      source: "http",
      request: new Request("http://x", { headers: { authorization: "Bearer tok-bravo" } }),
      envelope: { flowKind: "workforce-admin", action: "hire", input: {} },
    });
    expect(principal).toMatchObject({ orgId: OTHER_ORG });
  });
});

describe("V11 · a duplicate hire is refused and changes nothing", () => {
  it("leaves the original row's settings and the original address intact", async () => {
    const registrar = stubRegistrar();
    const flow = adminFlow();
    const stores = createInMemoryStores();

    const first = await callAdmin(flow, stores, "hire", {
      seatId: "support.ada",
      flow: "desk-clerk",
      settings: { desk: "front" },
    });
    expectAccepted(first);

    const second = await callAdmin(flow, stores, "hire", {
      seatId: "support.ada",
      flow: "desk-clerk",
      settings: { desk: "back" },
    });
    expectRefused(second, /already exists|support\.ada/i);

    // Not "one row still exists" — the ORIGINAL row, with the settings the
    // first hire supplied. An `upsert` would leave one row too, carrying
    // "back".
    const row = await storedRow(stores, "support.ada");
    expect(row).toMatchObject({ flow: "desk-clerk", settings: { desk: "front" } });
    expect(registrar.held.get("acme.support.ada")?.config).toMatchObject({ desk: "front" });
  });

  it("refuses when a ROW exists although no instance holds the address", async () => {
    // The case where `create()` is what does the refusing. A row can outlive
    // its registration two ways: a sibling process hired the seat (its row is
    // shared, its registration is not), and a compensating delete that itself
    // failed. Either way the row is the roster, so the hire must refuse — and
    // must not overwrite what is there.
    //
    // Red state: write with `upsert()` instead of `create()`. The second hire
    // succeeds and the stored settings become "back". This is the copy-paste
    // from the seat inventory next door, and it is the one that loses the
    // refusal with no other symptom.
    const registrar = stubRegistrar();
    const flow = adminFlow();
    const stores = createInMemoryStores();

    await callAdmin(flow, stores, "hire", {
      seatId: "support.ada",
      flow: "desk-clerk",
      settings: { desk: "front" },
    });
    // The address is released; the row is left exactly where it was.
    registrar.held.delete("acme.support.ada");
    expect(await storedRow(stores, "support.ada")).toBeDefined();

    const second = await callAdmin(flow, stores, "hire", {
      seatId: "support.ada",
      flow: "desk-clerk",
      settings: { desk: "back" },
    });

    expectRefused(second, /already exists|support\.ada/i);
    expect(await storedRow(stores, "support.ada")).toMatchObject({
      settings: { desk: "front" },
    });
  });

  it("hires the kind the ROW names, not one hidden in the settings bag", async () => {
    // `settings` is a passthrough bag, so `settings.flow` is storable, and
    // `settingsOf` strips `flow` as reserved before the kind validates —
    // nothing downstream objects. With `hiredSeatManifest` spreading
    // `{ flow: row.flow, ...row.settings }`, this hire mints and registers an
    // `agent` while the stored row says `desk-clerk` forever.
    //
    // The follow-on is the worse half, and it is asserted below: `fire` then
    // reads a stored kind of `desk-clerk` against a live kind of `agent`,
    // deletes the row, and leaves the instance registered — an address that
    // answers with no row anywhere saying it should, for the life of the
    // process.
    //
    // Red state: restore that spread order in
    // `packages/workforce/src/roster/rows.ts` and the kind assertion reads
    // "agent" and the fire assertions read `released: false` with the seat
    // still held.
    const registrar = stubRegistrar();
    const flow = adminFlow();
    const stores = createInMemoryStores();

    // Only the shadow key, deliberately: adding a `desk-clerk` setting would
    // make the shadowed `agent` kind REFUSE the bag, and the hire would fail
    // loudly — which is not the defect. The defect is that it succeeds.
    const hired = await callAdmin(flow, stores, "hire", {
      seatId: "support.ada",
      flow: "desk-clerk",
      settings: { flow: "agent" },
    });
    expectAccepted(hired);

    expect(registrar.held.get("acme.support.ada")?.kind).toBe("desk-clerk");
    expect(await storedRow(stores, "support.ada")).toMatchObject({ flow: "desk-clerk" });

    // The stored kind and the live kind agree, so the mismatch branch in
    // `fire` is unreachable for this row: the seat is released and nothing is
    // stranded.
    const fired = await callAdmin(flow, stores, "fire", { seatId: "support.ada" });
    expectAccepted(fired);
    expect(fired.output).toMatchObject({ released: true });
    expect(registrar.held.has("acme.support.ada")).toBe(false);
    expect(await storedRow(stores, "support.ada")).toBeUndefined();
  });

  it("refuses a kind this app does not carry before anything is written", async () => {
    stubRegistrar();
    const flow = adminFlow();
    const stores = createInMemoryStores();

    const result = await callAdmin(flow, stores, "hire", {
      seatId: "support.ada",
      flow: "a-kind-that-is-not-here",
      settings: {},
    });
    expectRefused(result, /a-kind-that-is-not-here/);
    expect(await storedRow(stores, "support.ada")).toBeUndefined();
  });

  it("refuses a setting the kind's schema does not admit, leaving no row", async () => {
    stubRegistrar();
    const flow = adminFlow();
    const stores = createInMemoryStores();

    const result = await callAdmin(flow, stores, "hire", {
      seatId: "support.ada",
      flow: "desk-clerk",
      settings: { aSettingTheKindDoesNotHave: true },
    });
    expectRefused(result, /aSettingTheKindDoesNotHave/);
    // The mint runs the kind's schema BEFORE the row is written, which is what
    // "no row, no registration" requires.
    expect(await storedRow(stores, "support.ada")).toBeUndefined();
  });

  it("refuses an organization that is not one legal address segment", async () => {
    stubRegistrar();
    const flow = adminFlow();
    const stores = createInMemoryStores();

    // `acme.support` + `ada` would spell `acme.support.ada` — the same address
    // `acme` + `support.ada` spells. Exactly one of them can be addressable.
    const result = await callAdmin(
      flow,
      stores,
      "hire",
      { seatId: "ada", flow: "desk-clerk", settings: {} },
      "acme.support"
    );
    expectRefused(result, /Organization id/);
  });

  it("lets two organizations hold a seat of the same name", async () => {
    const registrar = stubRegistrar();
    const flow = adminFlow();
    const stores = createInMemoryStores();

    const one = await callAdmin(
      flow, stores, "hire",
      { seatId: "support.ada", flow: "desk-clerk", settings: { desk: "front" } },
      ORG
    );
    const two = await callAdmin(
      flow, stores, "hire",
      { seatId: "support.ada", flow: "desk-clerk", settings: { desk: "back" } },
      OTHER_ORG
    );

    expectAccepted(one);
    expectAccepted(two);
    expect(registrar.held.has("acme.support.ada")).toBe(true);
    expect(registrar.held.has("bravo.support.ada")).toBe(true);
    expect(await storedRow(stores, "support.ada", ORG)).toMatchObject({ settings: { desk: "front" } });
    expect(await storedRow(stores, "support.ada", OTHER_ORG)).toMatchObject({ settings: { desk: "back" } });
  });
});

describe("V12 · two hires of one seat arriving together", () => {
  it("resolves exactly one, refuses the other, and leaves one row", async () => {
    const registrar = stubRegistrar();
    const flow = adminFlow();
    const stores = createInMemoryStores();

    const [a, b] = await Promise.all([
      callAdmin(flow, stores, "hire", {
        seatId: "support.ada",
        flow: "desk-clerk",
        settings: { desk: "front" },
      }),
      callAdmin(flow, stores, "hire", {
        seatId: "support.ada",
        flow: "desk-clerk",
        settings: { desk: "back" },
      }),
    ]);

    const accepted = [a, b].filter((r) => r.error === undefined);
    const refused = [a, b].filter((r) => r.error !== undefined);
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(1);

    const rows = await stores.resourceState.getByPrefix("org", ORG, "workforce/roster/");
    expect(Object.keys(rows)).toEqual(["workforce/roster/~admin/support.ada"]);
    expect(registrar.held.size).toBe(1);
  });
});

describe("V13 · a registration that fails leaves nothing behind", () => {
  it("deletes the row it just wrote and reports the registration failure", async () => {
    stubRegistrar({ refuse: true });
    const flow = adminFlow();
    const stores = createInMemoryStores();

    const result = await callAdmin(flow, stores, "hire", {
      seatId: "support.ada",
      flow: "desk-clerk",
      settings: { desk: "front" },
    });

    expectRefused(result, /refused this seat/);
    // Without the compensating delete the row survives, the caller is told the
    // hire failed, and the seat turns up at the next boot — a failed hire
    // leaving a live seat behind.
    expect(await storedRow(stores, "support.ada")).toBeUndefined();
  });
});

describe("fire", () => {
  it("removes the row and the address, and the removal survives a re-read", async () => {
    const registrar = stubRegistrar();
    const flow = adminFlow();
    const stores = createInMemoryStores();

    await callAdmin(flow, stores, "hire", {
      seatId: "support.ada",
      flow: "desk-clerk",
      settings: { desk: "front" },
    });
    const fired = await callAdmin(flow, stores, "fire", { seatId: "support.ada" });

    expectAccepted(fired);
    expect(fired.output).toMatchObject({ address: "acme.support.ada", released: true });
    expect(registrar.held.has("acme.support.ada")).toBe(false);
    expect(await storedRow(stores, "support.ada")).toBeUndefined();
  });

  it("refuses a seat this organization does not hold", async () => {
    stubRegistrar();
    const flow = adminFlow();
    const stores = createInMemoryStores();

    const result = await callAdmin(flow, stores, "fire", { seatId: "support.nobody" });
    expectRefused(result, /hired no seat/);
  });

  it("refuses to fire another organization's seat, even by exact id", async () => {
    stubRegistrar();
    const flow = adminFlow();
    const stores = createInMemoryStores();

    await callAdmin(
      flow, stores, "hire",
      { seatId: "support.ada", flow: "desk-clerk", settings: { desk: "front" } },
      OTHER_ORG
    );
    // Same seat id, different credential. The lookup is org-scoped.
    const result = await callAdmin(flow, stores, "fire", { seatId: "support.ada" }, ORG);
    expectRefused(result, /hired no seat/);
    expect(await storedRow(stores, "support.ada", OTHER_ORG)).toBeDefined();
  });

  it("V15b · leaves a FILE-DECLARED seat of the row's OWN kind alone (BR-28)", async () => {
    // BR-28 is written in terms of provenance: "the address … is held by an
    // instance that did NOT come from this org's row → nothing is
    // unregistered". V15 above checks a foreign instance of a DIFFERENT kind,
    // which a kind-equality check also catches — which is exactly why this
    // gap survived. Here the kinds MATCH, so only real provenance can tell
    // them apart.
    //
    // Reachable, not theoretical: hire a seat; later add a
    // `workforce/teams/` folder declaring one at the same address with the
    // same kind; restart. The file seat registers first, the reload's
    // duplicate is skipped and named (BR-21), and the row survives. That is
    // the state set up below.
    //
    // Red state: gate `fire` on `liveKind !== storedKind` again and this
    // fails — the file-declared seat is unregistered, contradicting the
    // refusal `fire` itself raises three lines earlier, which promises such a
    // seat is removed by editing its folder.
    const registrar = stubRegistrar();
    const flow = adminFlow();
    const stores = createInMemoryStores();

    await callAdmin(flow, stores, "hire", {
      seatId: "support.ada",
      flow: "desk-clerk",
      settings: { desk: "front" },
    });

    // The restart: the address is released and re-taken by a seat this app did
    // NOT register from the row — same address, same kind.
    workforceRegistrar.unregister("acme.support.ada");
    registrar.held.set("acme.support.ada", {
      id: "acme.support.ada",
      kind: "desk-clerk",
    } as unknown as FlowInstance);

    const fired = await callAdmin(flow, stores, "fire", { seatId: "support.ada" });

    expectAccepted(fired);
    expect(fired.output).toMatchObject({ released: false });
    // The row goes — this org did hire it. The file-declared seat stays.
    expect(await storedRow(stores, "support.ada")).toBeUndefined();
    expect(registrar.held.has("acme.support.ada")).toBe(true);
  });

  it("V15 · leaves an address alone when a foreign instance holds it", async () => {
    const registrar = stubRegistrar();
    const flow = adminFlow();
    const stores = createInMemoryStores();

    await callAdmin(flow, stores, "hire", {
      seatId: "support.ada",
      flow: "desk-clerk",
      settings: { desk: "front" },
    });

    // Something else takes the address between the hire and the fire. The
    // address grammar is supposed to make this unreachable; the check is here
    // because a guarantee nobody checks is how this goes wrong.
    registrar.held.set("acme.support.ada", {
      id: "acme.support.ada",
      kind: "some-other-kind",
    } as unknown as FlowInstance);

    const fired = await callAdmin(flow, stores, "fire", { seatId: "support.ada" });

    expectAccepted(fired);
    expect(fired.output).toMatchObject({ released: false });
    // The row goes; the foreign instance stays. Unregistering by address alone
    // would take it offline.
    expect(await storedRow(stores, "support.ada")).toBeUndefined();
    expect(registrar.held.get("acme.support.ada")?.kind).toBe("some-other-kind");
  });
});

describe("roster registration", () => {
  it("refuses a hired seat that arrives with no pin, and does not mark it", () => {
    const registrar = stubRegistrar();
    const seat = { id: "acme.research", kind: "desk-clerk" } as FlowInstance;
    expect(() => workforceRegistrar.registerFromRoster(seat)).toThrow(/owner pin/);
    expect(registrar.held.has(seat.id)).toBe(false);
    expect(workforceRegistrar.isFromRoster(seat.id)).toBe(false);
  });

  it("admits a hired seat whose row already stamped a pin", () => {
    const seen: Array<{ orgId: string; userId?: string } | undefined> = [];
    setWorkforceRegistrarImpl({
      register: (_flow, options) => {
        seen.push(options?.pin);
      },
      unregister: () => false,
      kindAt: () => undefined,
    });
    const seat = {
      id: "acme.x",
      kind: "desk-clerk",
      ownerPin: { orgId: "acme", userId: "alice" },
    } as FlowInstance;
    workforceRegistrar.registerFromRoster(seat);
    expect(seen).toEqual([{ orgId: "acme", userId: "alice" }]);
    expect(workforceRegistrar.isFromRoster("acme.x")).toBe(true);
  });
});
