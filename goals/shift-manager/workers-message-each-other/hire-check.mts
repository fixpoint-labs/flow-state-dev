/**
 * Leg 4's hire check, run in its own process so a control's patch reaches the
 * hire it grades: the workforce kit from the checkout at argv[2], started over
 * an empty folder with a worker flow with no `onMessageReceived` in its
 * `workerFlows` slot, and then the same flow with one. Prints
 * `{ deaf, heard }`, each the start's refusal or `null`.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const root = process.argv[2];
if (root === undefined) throw new Error("usage: hire-check.mts <checkout root>");
const load = async (pkg: string, entry = "index.ts") => import(pathToFileURL(join(root, "packages", pkg, "src", entry)).href);
const core = await load("core");
const engine = await load("engine");
const workforce = await load("workforce");
const { workforce: workforceKit } = await load("workforce", "kit/index.ts");

// A folder with no workers: the flow is the only thing under test.
const scratch = mkdtempSync(join(tmpdir(), "fsd-hire-check-"));
const directory = join(scratch, "workforce");
mkdirSync(directory);
process.once("exit", () => rmSync(scratch, { recursive: true, force: true }));

const door = z.object({ message: z.string() });

/** One start of the kit with a flow `deaf`, with `internal` as its internal actions: its refusal, or `null`. */
async function hire(internal: (installation: any) => Record<string, unknown>): Promise<string | null> {
  const deaf = (installation: any) => core.defineFlow({
    kind: "deaf",
    configSchema: workforce.workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workforce.workerMessagesResources },
    actions: {
      respond: {
        inputSchema: door,
        userMessage: (i: { message: string }) => i.message,
        block: core.handler({ name: "deaf-run", inputSchema: door, execute: (i: unknown) => i }),
      },
    },
    internal: { actions: internal(installation) },
  });
  const state = engine.createFlowState({
    kits: [workforceKit({ directory })],
    fill: { [workforceKit.slots.workerFlows]: { deaf: workforce.workerFlow(deaf) } },
    stores: { goal: { primary: engine.inMemoryStores() } },
  });
  try {
    await state.ready();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await state.dispose();
  }
}

const deaf = await hire(() => ({}));
const heard = await hire((installation) => ({
  onMessageReceived: workforce.messageReceivedEntry({ installation, flowKind: "deaf" }),
}));
console.log(JSON.stringify({ deaf, heard }));
