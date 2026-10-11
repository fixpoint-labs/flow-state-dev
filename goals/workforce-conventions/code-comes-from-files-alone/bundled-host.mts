/**
 * The app leg (e) bundles: a host whose only route to the fixture's worker kind
 * is the generated module.
 *
 * `run.mts` builds this file into one production bundle with esbuild, writes
 * the bundle to an empty folder outside the repository, and runs it there with
 * plain `node`. Nothing next to the bundle holds the fixture's source, so the
 * kind answers only if the generated module's static imports were carried into
 * the bundle. A host that found its kinds by scanning a folder at run time
 * would find no folder.
 *
 * The workers' `WORKER.md` records arrive as data, in the JSON file named by
 * `argv[2]`: those are files an app deploys beside its code, and this leg is
 * about the code. It prints one JSON line, `{ "answers": { <workerId>: said } }`.
 */
import { readFileSync } from "node:fs";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createWorkerInstallation, hireWorkforce, type WorkerManifest } from "@flow-state-dev/workforce";
import { kinds } from "./fixtures/workforce/workforce.gen.ts";

interface HostInput {
  userId: string;
  note: string;
  kind: string;
  seats: string[];
  workers: WorkerManifest[];
}

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as HostInput;
const installation = createWorkerInstallation({ standardWorkers: input.workers, workerFlows: kinds as never });
const copies = hireWorkforce(installation);
const state = createFlowState({
  flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
  stores: { default: { primary: inMemoryStores() } },
} as never);

const answers: Record<string, string> = {};
try {
  const runtime = await state.getRuntime();
  const router = await state.getRouter();
  const copy = copies.find((c) => c.kind === input.kind);
  for (const seatId of input.seats) {
    if (copy === undefined) break;
    const sessionPath = [copy.id, "sessions"];
    await router.POST(
      new Request(`http://goal/api/flows/${sessionPath.join("/")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: input.userId, sessionId: `s_${seatId}`, state: { workerId: seatId } }),
      }),
      { params: { path: sessionPath } },
    );
    const ran = (await runAction({
      flow: copy,
      actionName: "answer",
      input: { note: input.note },
      userId: input.userId,
      orgId: DEFAULT_ORG_ID,
      sessionId: `s_${seatId}`,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    } as never)) as { output?: { said?: string } };
    answers[seatId] = ran.output?.said ?? "";
  }
} finally {
  await state.dispose();
}
process.stdout.write(`${JSON.stringify({ kinds: Object.keys(kinds), answers })}\n`);
