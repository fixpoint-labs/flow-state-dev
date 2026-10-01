/**
 * FIX-1728 POC · project resource → templated talk channel.
 *
 * Throwaway experiment. Not a workspace package, not in default test/lint/knip
 * discovery. Run by hand; see README.md.
 *
 * The load-bearing claim: an org project can be a resource row, and creating
 * it can open a user-bound talk session through the shipped binder, with an
 * explicit resourceId ↔ session link and without putting project fields in
 * session state, inventing a projects tree, or turning isolation-off into a
 * shared room.
 *
 * Each check has a control that is run. A green check nobody has seen fail is
 * not evidence.
 */

import { defineFlow, handler } from "../../../../../packages/core/src/index";
import { createInMemoryStores, runAction } from "../../../../../packages/engine/src/index";
import type { StoreRegistry } from "../../../../../packages/engine/src/index";
import {
  CHANNEL_KIND,
  channelInstances,
  openChannels
} from "../../../../../packages/workforce/src/channel";
import { z } from "zod";
import {
  PROJECT_COLLECTION_PATTERN,
  TALK_SESSION_PREFIX,
  createProjectTalkChannel,
  defineProjectResourceCollection,
  projectIdFromTalkSession,
  talkChannelManifest,
  talkSessionIdFor,
  type ProjectResource
} from "./create-project-talk-channel.mts";

let failures = 0;
const ok = (name: string) => console.log(`  PASS  ${name}`);
const bad = (name: string, detail: string) => {
  failures += 1;
  console.log(`  FAIL  ${name}\n        ${detail}`);
};
const expect = (name: string, cond: boolean, detail: string) =>
  cond ? ok(name) : bad(name, detail);

const OWNER = "u_cos";
const OTHER = "u_other";
const ORG = "org_acme";
const OTHER_ORG = "org_other";

const projectRowInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().min(1),
  owner: z.string().nullable(),
  links: z.array(z.string()),
  talkSessionId: z.string().min(1)
});

type Occupant = {
  flowKind: string;
  flowId?: string;
  userId: string;
  state: Record<string, unknown>;
  description?: string;
};

function sessionClient() {
  const created: Array<Record<string, unknown>> = [];
  const sessions = new Map<string, Occupant>();

  return {
    created,
    sessions,
    client: {
      createSession: async (options: {
        flowKind: string;
        userId: string;
        sessionId?: string;
        description?: string;
        state?: Record<string, unknown>;
      }) => {
        const id = String(options.sessionId);
        if (sessions.has(id)) {
          throw Object.assign(new Error("Request failed (409)"), { status: 409 });
        }
        sessions.set(id, {
          flowKind: options.flowKind,
          flowId: options.flowKind,
          userId: options.userId,
          state: options.state ?? {},
          ...(options.description === undefined ? {} : { description: options.description })
        });
        created.push({ sessionId: id, ...options });
        return { id };
      },
      getSession: async (sessionId: string) => {
        const session = sessions.get(sessionId);
        if (session === undefined) {
          throw Object.assign(new Error("Request failed (404)"), { status: 404 });
        }
        return { id: sessionId, ...session };
      },
      deleteSession: async (sessionId: string) => {
        sessions.delete(sessionId);
      }
    }
  };
}

function memoryStore() {
  const rows = new Map<string, ProjectResource>();
  return {
    rows,
    store: {
      upsert: async (id: string, row: ProjectResource) => {
        rows.set(id, row);
      },
      get: async (id: string) => rows.get(id)
    }
  };
}

const PROJECT_KEYS = ["name", "status", "owner", "links"] as const;

console.log("FIX-1728 POC · project resource → templated talk channel\n");

// ---------------------------------------------------------------------------
// Check 1 — the create path. Resource holds the project; session is talk.
// ---------------------------------------------------------------------------
console.log("Check 1 · create writes an org project and opens a user-bound talk session");

{
  const { client, sessions, created } = sessionClient();
  const { store, rows } = memoryStore();
  const result = await createProjectTalkChannel({
    project: {
      id: "alpha",
      name: "Alpha",
      status: "active",
      owner: "cos",
      links: ["https://linear.app/fixpoint-labs/issue/FIX-1728"]
    },
    userId: OWNER,
    client,
    store,
    members: ["org.cos"]
  });

  const row = rows.get("alpha");
  const session = sessions.get(result.talkSessionId);

  expect(
    "resource row has the durable fields and the session id",
    row?.name === "Alpha" &&
      row.status === "active" &&
      row.owner === "cos" &&
      row.links.length === 1 &&
      row.talkSessionId === result.talkSessionId,
    `got ${JSON.stringify(row)}`
  );
  expect(
    "talk session id is project-talk.<id> and parses back",
    result.talkSessionId === `${TALK_SESSION_PREFIX}alpha` &&
      projectIdFromTalkSession(result.talkSessionId) === "alpha",
    result.talkSessionId
  );
  expect(
    "session is bound to the creating user on the built-in kind",
    session?.userId === OWNER && session.flowKind === CHANNEL_KIND,
    JSON.stringify(session && { userId: session.userId, flowKind: session.flowKind })
  );
  expect(
    "session state is only members / instructions / transcript",
    session !== undefined &&
      Object.keys(session.state).sort().join(",") === "instructions,members,transcript",
    `keys: ${session ? Object.keys(session.state).join(",") : "missing"}`
  );
  expect(
    "session state does not carry name, status, owner, or links",
    session !== undefined && PROJECT_KEYS.every((key) => !(key in session.state)),
    JSON.stringify(session?.state)
  );
  expect(
    "one createSession call, members from the hand-built record",
    created.length === 1 &&
      JSON.stringify((session?.state.members as unknown) ?? null) === JSON.stringify(["org.cos"]),
    `created=${created.length} members=${JSON.stringify(session?.state.members)}`
  );

  // Control: a dotted project id is refused, so the parse-back convention is
  // a real constraint rather than a comment. If this accepted, the reverse
  // link would be ambiguous.
  let refused = "";
  try {
    await createProjectTalkChannel({
      project: { id: "eng.alpha", name: "No" },
      userId: OWNER,
      client,
      store
    });
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  expect(
    "control · a dotted project id is refused so the session id can parse back",
    refused.includes("single segment"),
    refused || "dotted id was accepted"
  );
}

// ---------------------------------------------------------------------------
// Check 2 — two projects are two sessions on one kind, not two kinds.
// ---------------------------------------------------------------------------
console.log("\nCheck 2 · two projects share the built-in channel kind");

{
  const a = talkChannelManifest({ projectId: "alpha", name: "Alpha" });
  const b = talkChannelManifest({ projectId: "beta", name: "Beta" });
  const instances = channelInstances([a, b]);
  expect(
    "two project talk rooms are one channel instance",
    instances.length === 1 && instances[0]?.kind === CHANNEL_KIND,
    `got ${instances.map((instance) => instance.kind).join(",")}`
  );
  expect(
    "session ids stay distinct",
    a.id !== b.id &&
      projectIdFromTalkSession(a.id) === "alpha" &&
      projectIdFromTalkSession(b.id) === "beta",
    `${a.id} / ${b.id}`
  );

  // Control: a second registered kind is a second instance. If this stayed
  // at one, "create is a session on an existing kind" would be untestable.
  const custom = Object.assign(() => ({ id: "briefing", kind: "briefing" }), {
    kind: "briefing"
  });
  const twoKinds = channelInstances(
    [a, talkChannelManifest({ projectId: "gamma", name: "Gamma", channelKind: "briefing" })],
    { kinds: { briefing: custom } }
  );
  expect(
    "control · naming a second kind is a second instance",
    twoKinds.map((instance) => instance.kind).sort().join(",") === "briefing,channel",
    twoKinds.map((instance) => instance.kind).join(",")
  );
}

// ---------------------------------------------------------------------------
// Check 3 — the project is org-discoverable; another org reads nothing.
// ---------------------------------------------------------------------------
console.log("\nCheck 3 · the project collection is org-scoped and shared across flows");

{
  const projects = defineProjectResourceCollection();
  expect(
    "collection is org-scoped at projects/*, isolation spelled false",
    projects.pattern === PROJECT_COLLECTION_PATTERN &&
      projects.scope === "org" &&
      projects.flowIsolation === false,
    JSON.stringify({
      pattern: projects.pattern,
      scope: projects.scope,
      flowIsolation: projects.flowIsolation
    })
  );

  const writeBlock = handler({
    name: "project-write",
    inputSchema: projectRowInput,
    outputSchema: z.object({ written: z.literal(true) }),
    resources: { projects },
    execute: async (input, ctx) => {
      await ctx.resources.projects.upsert(input.id, input);
      return { written: true as const };
    }
  });
  const readBlock = handler({
    name: "project-read",
    inputSchema: z.object({}),
    outputSchema: z.object({ rows: z.array(z.unknown()) }),
    resources: { projects },
    execute: async (_input, ctx) => ({
      rows: (await ctx.resources.projects.list()).map((ref) => ref.state)
    })
  });

  const stores = createInMemoryStores() as StoreRegistry;
  const writer = defineFlow({
    kind: "project-writer",
    isolateOrgState: true,
    actions: { write: { block: writeBlock } }
  })();
  const reader = defineFlow({
    kind: "project-reader",
    isolateOrgState: true,
    actions: { read: { block: readBlock } }
  })();

  const row: ProjectResource = {
    id: "alpha",
    name: "Alpha",
    status: "active",
    owner: "cos",
    links: [],
    talkSessionId: talkSessionIdFor("alpha")
  };

  await runAction({
    flow: writer,
    actionName: "write",
    input: row,
    userId: OWNER,
    orgId: ORG,
    stores,
    runtimeConfig: {} as never
  });

  const sameOrg: any = await runAction({
    flow: reader,
    actionName: "read",
    input: {},
    userId: OTHER,
    orgId: ORG,
    stores,
    runtimeConfig: {} as never
  });
  const otherOrg: any = await runAction({
    flow: reader,
    actionName: "read",
    input: {},
    userId: OTHER,
    orgId: OTHER_ORG,
    stores,
    runtimeConfig: {} as never
  });

  const sameRows = (sameOrg.output ?? sameOrg).rows as ProjectResource[];
  const otherRows = (otherOrg.output ?? otherOrg).rows as ProjectResource[];

  expect(
    "a different flow in the same org reads the project (even with isolateOrgState)",
    sameRows.length === 1 && sameRows[0]?.id === "alpha" && sameRows[0]?.talkSessionId === row.talkSessionId,
    JSON.stringify(sameRows)
  );
  expect(
    "control · a different org reads nothing — the empty read is only evidence because the same-org read was not",
    sameRows.length === 1 && otherRows.length === 0,
    `same=${JSON.stringify(sameRows)} other=${JSON.stringify(otherRows)}`
  );
}

// ---------------------------------------------------------------------------
// Check 4 — a second user does not share the talk session.
// Isolation-off as a shared room would let them in; user-bound refuses.
// ---------------------------------------------------------------------------
console.log("\nCheck 4 · a second userId cannot adopt the talk session as a shared room");

{
  const { client, sessions } = sessionClient();
  const { store } = memoryStore();
  const { manifest, talkSessionId } = await createProjectTalkChannel({
    project: { id: "alpha", name: "Alpha" },
    userId: OWNER,
    client,
    store
  });

  let refused = "";
  try {
    await openChannels([manifest], { client, userId: OTHER });
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }

  expect(
    "second userId is refused; the session still belongs to the creator",
    refused.includes(`"${OWNER}"`) && sessions.get(talkSessionId)?.userId === OWNER,
    refused || "second userId was accepted"
  );
  await openChannels([manifest], { client, userId: OWNER });
  const after = sessions.get(talkSessionId);
  expect(
    "control · the same userId re-opening is a no-op (bound channel left alone)",
    after?.userId === OWNER &&
      Object.keys(after.state).sort().join(",") === "instructions,members,transcript",
    JSON.stringify(after)
  );
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
