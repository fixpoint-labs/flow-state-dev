/**
 * Goal check — resource-collections › it reads and writes instance content via
 * the generic tools (FIX-842). Real model, real path, out of CI. See goal.md.
 *
 * Non-flow goal: it builds a throwaway flow with a session collection that opts
 * into llmReadable/llmWritable, wires a generator with the GENERIC content tools,
 * and drives the public `runAction` API on a real model. It then reads the
 * instance body back from the real ContentStore and grades it against the
 * held-out fixture — the secret only reaches the stored body if the model
 * actually read the instance and wrote it back.
 *
 * Run (deps resolve via the `goals` workspace package):
 *   pnpm tsx goals/resource-collections/agent-reads-and-writes-instance-content/run.mts
 */
import {
  defineFlow,
  defineResourceCollection,
  generator,
  readResourceContentTool,
  sequencer,
  writeResourceContentTool,
} from "@flow-state-dev/core";
import { z } from "zod";
import {
  createInMemoryStores,
  createModelResolver,
  createResponseEmitter,
  runAction,
} from "@flow-state-dev/engine";
import {
  DEFAULT_MODEL,
  goalSessionId,
  loadFixture,
  runGoal,
  silentLogger,
} from "../../lib/index.mts";

// This goal deliberately runs on the AMBIENT ladder rather than stripping it
// (see goals/lib/env.mts): it declares the intents below so the generator
// resolves a concrete model id through whatever gateway the env provides.
const MODEL = process.env.FSDEV_DEFAULT_MODEL ?? DEFAULT_MODEL;

// Held-out fixture. The runner reads `secret` from here and the prompt never
// names it, so a different body + secret must still pass a correct impl.
const fixture = loadFixture<{ noteKey: string; seedBody: string; secret: string }>(
  import.meta.url,
  "note.json",
);

const inputSchema = z.object({ message: z.string() });

const notes = defineResourceCollection({
  pattern: "notes/**",
  scope: "session",
  stateSchema: z.object({ title: z.string().default("") }),
  llmReadable: true,
  llmWritable: true,
});
const resources = { notes };

const editor = generator({
  name: "notes-editor",
  model: MODEL,
  prompt: [
    "You edit notes stored as resources, using the resource content tools.",
    `Step 1: call readResourceContent with uri 'session/notes/${fixture.noteKey}' to read the note body.`,
    "Step 2: the body names a secret word. Call writeResourceContent on uri",
    `'session/notes/${fixture.noteKey}' with content exactly 'CONFIRMED: <word>' (substitute the`,
    "secret word you just read). Then reply with 'done'.",
  ].join("\n"),
  inputSchema,
  user: (input) => input.message,
  outputSchema: z.string(),
  tools: [readResourceContentTool(), writeResourceContentTool()],
  resources,
  itemVisibility: { client: true, history: true },
  maxIterations: 6,
});

const pipeline = sequencer({ name: "notes-pipeline", inputSchema }).step(editor);

const flow = defineFlow({
  kind: "goal-resource-collection-content",
  requireUser: true,
  actions: { run: { inputSchema, block: pipeline, userMessage: (i) => i.message } },
  resources,
  session: { stateSchema: z.object({}) },
})({ id: "default" });

await runGoal(async () => {
  const stores = createInMemoryStores();
  const sessionId = goalSessionId("resource-collections");
  const userId = "goal-user";
  const storageKey = `notes/${fixture.noteKey}`;

  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind: "goal-resource-collection-content",
      userId,
      state: {},
      version: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      journal: [],
    },
    "any",
  );
  // State in ResourceStateStore (so the collection enumerates the instance),
  // body in ContentStore (what readContent returns) — FIX-689 keeps them apart.
  await stores.resourceState.set("session", sessionId, storageKey, { title: "A" });
  await stores.content.set("session", sessionId, storageKey, fixture.seedBody);

  const responseEmitter = createResponseEmitter({ requestId: "goal_req_1", onEvent: () => {} });

  const result = await runAction({
    flow,
    actionName: "run",
    input: { message: "Please confirm the note." },
    userId,
    sessionId,
    stores,
    responseEmitter,
    runtimeConfig: {
      // Declare the intents the ambient FSDEV_INTENT_* overrides bind to; the
      // generator runs on a concrete model id loaded through the ambient gateway.
      modelResolver: createModelResolver({
        defaultModel: MODEL,
        intents: { chat: [MODEL], plan: [MODEL], reason: [MODEL], utility: [MODEL] },
      }),
      logger: silentLogger,
    },
  });

  // Grade the user-visible side effect: the persisted instance body, read back
  // from the real ContentStore — NOT a tool-call count or the success flag.
  const after = await stores.content.get("session", sessionId, storageKey);
  const failures: string[] = [];
  if (result.error !== undefined) failures.push(`flow errored: ${result.error.message}`);
  if (typeof after !== "string") {
    failures.push("note body is missing after the run");
  } else {
    if (after === fixture.seedBody) failures.push("note body unchanged — write did not happen");
    if (!after.toLowerCase().includes(fixture.secret.toLowerCase())) {
      failures.push(
        `note body did not carry the held-out secret — read did not happen (got ${JSON.stringify(after)})`,
      );
    }
  }

  return {
    failures,
    evidence:
      `note '${storageKey}' rewritten to ${JSON.stringify(after)} (model: ${MODEL}). ` +
      `Graded persisted body for the held-out secret + a change from seed; not on tool calls or success flag.`,
  };
});
