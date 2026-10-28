/**
 * Leg 4's hire check, run in its own process so a control's patch reaches the
 * hire it grades: `hireWorkforce` from the checkout at argv[2], given a worker
 * flow with no `onMessageReceived` and then the same flow with one. Prints
 * `{ deaf, heard }`, each the hire's refusal or `null`.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const root = process.argv[2];
if (root === undefined) throw new Error("usage: hire-check.mts <checkout root>");
const load = async (pkg: string) => import(pathToFileURL(join(root, "packages", pkg, "src", "index.ts")).href);
const core = await load("core");
const workforce = await load("workforce");

const door = z.object({ message: z.string() });

/** One hire of a flow `deaf`, with `internal` as its internal actions: its refusal, or `null`. */
function hire(internal: (installation: any) => Record<string, unknown>): string | null {
  let flows: Record<string, unknown> = {};
  const installation = workforce.createWorkerInstallation({ standardWorkers: [], workerFlows: () => flows as never });
  const deaf = core.defineFlow({
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
  flows = { deaf };
  try {
    workforce.hireWorkforce(installation);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const deaf = hire(() => ({}));
const heard = hire((installation) => ({
  [workforce.MESSAGE_RECEIVED_ENTRY]: workforce.messageReceivedEntry({ installation, flowKind: "deaf" }),
}));
console.log(JSON.stringify({ deaf, heard }));
