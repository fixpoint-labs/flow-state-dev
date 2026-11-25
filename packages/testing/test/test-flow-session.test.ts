import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { expect, it } from "vitest";
import { z } from "zod";
import { testFlow } from "../src";

const sessionStateSchema = z.object({ token: z.string().default(() => crypto.randomUUID()) });
const marker = z.object({ value: z.string() });
const flow = defineFlow({
  kind: "test-session-creation",
  session: { stateSchema: sessionStateSchema },
  actions: {
    read: handler({
      name: "read",
      inputSchema: z.object({}),
      sessionStateSchema,
      resources: {
        profile: defineResource({ scope: "user", stateSchema: marker }),
        team: defineResource({ scope: "org", stateSchema: marker })
      },
      execute: (_input, ctx) => ({
        lineageId: ctx.session.lineageId,
        token: ctx.session.state.token,
        profile: ctx.resources.profile.state.value,
        team: ctx.resources.team.state.value
      })
    })
  }
})();

const options = {
  flow,
  action: "read",
  input: {},
  userId: "alice",
  sessionId: "shared",
  seed: {
    user: { resources: { profile: { value: "Alice" } } },
    org: { resources: { team: { value: "Support" } } }
  }
};

it("creates an unseeded session with the flow's factory defaults and reuses it on the next run", async () => {
  const stores = createInMemoryStores();
  const first = await testFlow({ ...options, stores });
  expect(first.error).toBeUndefined();
  const session = await stores.session.get(options.sessionId);
  expect(session).toMatchObject({ lineageId: expect.stringMatching(/^lin_/), state: { token: expect.any(String) } });
  expect(session?.lineageId).not.toBe(`lin_${options.sessionId}`);
  expect(first.output).toEqual({ lineageId: session?.lineageId, token: session?.state.token, profile: "Alice", team: "Support" });

  const second = await testFlow({ ...options, stores });
  expect(second.error).toBeUndefined();
  expect(second.output).toEqual(first.output);
});

it("treats an explicitly seeded session as a stored record that can predate a factory default", async () => {
  const stores = createInMemoryStores();
  const run = await testFlow({ ...options, stores, seed: { ...options.seed, session: { state: {} } } });
  expect(run.error).toBeUndefined();
  const session = await stores.session.get(options.sessionId);
  expect(session).toBeDefined();
  expect(session?.lineageId).toBeUndefined();
  expect(run.output).toEqual({ lineageId: `lin_${options.sessionId}`, token: undefined, profile: "Alice", team: "Support" });
});
