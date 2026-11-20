/**
 * Who a request is on the lab's host. The lab takes every request as its own
 * user, whoever the request names, so a second caller is refused rather than
 * served as someone else. A host built with `user` (a goal's, serving two
 * users) takes each request as the user it names there, and each sees only
 * their own conversations.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import type { PrincipalResolutionContext } from "@flow-state-dev/core/types";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { scriptedModels } from "../../test-support/contract";
import { openTeammates } from "../host.mts";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** The lab's host in process; `user` as given. A client per caller, signed in by an `x-user` header. */
async function openHost(user?: (context: PrincipalResolutionContext) => string | undefined) {
  const data = mkdtempSync(join(tmpdir(), "teammates-lab-users-"));
  cleanups.push(() => rmSync(data, { recursive: true, force: true }));
  const repo = join(data, "repo");
  execFileSync("git", ["init", "-q", repo]);
  const flowState = await openTeammates({
    store: join(data, "teammates.sqlite"),
    model: "test/scripted",
    userId: "alice",
    workdir: repo,
    runsRoot: join(data, "runs"),
    scriptedHarnessStepMs: 50,
    modelResolver: scriptedModels({}) as never,
    ...(user === undefined ? {} : { user }),
  });
  cleanups.push(async () => (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.());
  const inProcess = createInProcessFetch(flowState as never) as unknown as typeof fetch;
  return (userId: string) => {
    const client = createClient({
      userId,
      baseUrl: "",
      fetcher: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("x-user", userId);
        return inProcess(input, { ...init, headers });
      },
    });
    return { client, chief: () => createWorkforceClient(client).ensureWorkerSession({ worker: CHIEF }) };
  };
}

const CHIEF = "teammates.chief-of-staff";

describe("who a request is on the lab's host", () => {
  it("takes every request as the lab's own user: a second caller can't make a conversation", async () => {
    const as = await openHost();
    await as("alice").chief();
    await expect(as("bob").chief()).rejects.toThrow(/403/);
  });

  it("with `user`, takes each request as the user it names, and each lists only their own", async () => {
    const as = await openHost((context) => context.request?.headers.get("x-user") ?? undefined);
    const alices = (await as("alice").chief()).id;
    const bobs = (await as("bob").chief()).id;
    expect(bobs).not.toBe(alices);
    expect((await as("alice").client.sessions.list({ userId: "alice" })).map((s) => s.id)).toEqual([alices]);
    expect((await as("bob").client.sessions.list({ userId: "bob" })).map((s) => s.id)).toEqual([bobs]);
  });
});
