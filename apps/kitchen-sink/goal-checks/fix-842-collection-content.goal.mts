/**
 * Goal check for FIX-842 — real-model proof that a collection opting into
 * `llmReadable` / `llmWritable` is read and written by a generator through the
 * GENERIC content tools (`readResourceContentTool` / `writeResourceContentTool`),
 * addressed by scope-qualified uri. No per-collection read/write blocks.
 *
 * Out of CI: hits a real model via the ambient gateway. Run by hand:
 *   pnpm exec tsx goal-checks/fix-842-collection-content.goal.mts
 *
 * PASS iff the note body was rewritten to carry the secret word the model could
 * only have learned by reading it — i.e. read AND write both worked end to end.
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
} from "@flow-state-dev/server";

const MODEL = process.env.FSDEV_DEFAULT_MODEL ?? "vercel/openai/gpt-5.4-nano";
const SECRET = "daffodil";
const SEED_BODY = `the secret word is ${SECRET}`;

const inputSchema = z.object({ message: z.string() });

// A content-bearing collection that opts the LLM into read + write. Nothing here
// is artifact- or bash-specific — the generic tools are the whole surface.
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
    "Step 1: call readResourceContent with uri 'session/notes/a' to read the note body.",
    "Step 2: the body names a secret word. Call writeResourceContent on uri",
    "'session/notes/a' with content exactly 'CONFIRMED: <word>' (substitute the",
    "secret word you just read).",
    "Then reply with 'done'.",
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

const goalFlow = defineFlow({
  kind: "fix842-goalcheck",
  requireUser: true,
  actions: {
    run: { inputSchema, block: pipeline, userMessage: (i) => i.message },
  },
  resources,
  session: { stateSchema: z.object({}) },
});

const flow = goalFlow({ id: "default" });

async function main(): Promise<void> {
  const stores = createInMemoryStores();
  const sessionId = "goal_sess_1";
  const userId = "goal-user";

  // Seed the instance. State and content live in dedicated stores (FIX-689) —
  // ResourceStateStore (so the collection enumerates the instance) and
  // ContentStore (what readContent returns), NOT the session record's fields.
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind: "fix842-goalcheck",
      userId,
      state: {},
      version: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      journal: [],
    },
    "any",
  );
  await stores.resourceState.set("session", sessionId, "notes/a", { title: "A" });
  await stores.content.set("session", sessionId, "notes/a", SEED_BODY);

  const responseEmitter = createResponseEmitter({ requestId: "goal_req_1", onEvent: () => {} });
  const silent = { debug() {}, info() {}, warn() {}, error() {} };

  const result = await runAction({
    flow,
    actionName: "run",
    input: { message: "Please confirm note a." },
    userId,
    sessionId,
    stores,
    responseEmitter,
    runtimeConfig: {
      // Declare the intents the ambient FSDEV_INTENT_* env overrides bind to, so
      // the resolver accepts them. The generator uses a concrete model id, which
      // the resolver loads through the ambient gateway.
      modelResolver: createModelResolver({
        defaultModel: MODEL,
        intents: { chat: [MODEL], plan: [MODEL], reason: [MODEL], utility: [MODEL] },
      }),
      logger: silent,
    },
  });

  const after = await stores.content.get("session", sessionId, "notes/a");
  const changed = after !== SEED_BODY;
  const carriedSecret = typeof after === "string" && after.includes(SECRET);
  const pass = result.error === undefined && changed && carriedSecret;

  console.log(`model     : ${MODEL}`);
  console.log(`output    : ${JSON.stringify(result.output)}`);
  console.log(`note body : ${JSON.stringify(after)}`);
  if (result.error) console.log(`error     : ${result.error.message}`);
  console.log(pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("FAIL (threw):", err);
  process.exit(1);
});
