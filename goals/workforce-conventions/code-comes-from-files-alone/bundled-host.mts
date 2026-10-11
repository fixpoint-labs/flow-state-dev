/**
 * Leg (e)'s bundle entry, and the hire → session → `answer` sequence leg (d)
 * runs too. The kind is imported only from the generated module. Worker records
 * for the bundled run arrive as JSON on argv. The process prints one line,
 * `{ kinds, answers }`.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createWorkerInstallation, hireWorkforce, type WorkerManifest } from "@flow-state-dev/workforce";
import { kinds } from "./fixtures/workforce/workforce.gen.ts";

export interface SeatAnswer {
  declaredFlow: unknown;
  status: number;
  said: string;
  error?: unknown;
}

/** Hire `workers` onto the caller's `kinds` and run each seat's `answer`. */
export async function answerSeats(input: {
  kinds: Record<string, unknown>;
  workers: readonly WorkerManifest[];
  userId: string;
  note: string;
  kind: string;
  seats: readonly string[];
}): Promise<{ registered: string[]; found: boolean; answers: Record<string, SeatAnswer> }> {
  const installation = createWorkerInstallation({ standardWorkers: input.workers, workerFlows: input.kinds as never });
  const copies = hireWorkforce(installation);
  const state = createFlowState({
    flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    stores: { default: { primary: inMemoryStores() } },
  } as never);
  const answers: Record<string, SeatAnswer> = {};
  const registered = copies.map((copy) => copy.id);
  const copy = copies.find((c) => c.kind === input.kind);
  try {
    if (copy === undefined) return { registered, found: false, answers };
    const runtime = await state.getRuntime();
    const router = await state.getRouter();
    for (const seatId of input.seats) {
      const declaredFlow = installation.standardWorker(seatId)?.declared.flow;
      const sessionPath = [copy.id, "sessions"];
      const created = await router.POST(
        new Request(`http://goal/api/flows/${sessionPath.join("/")}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: input.userId, sessionId: `s_${seatId}`, state: { workerId: seatId } }),
        }),
        { params: { path: sessionPath } },
      );
      if (created.status !== 201) {
        answers[seatId] = { declaredFlow, status: created.status, said: "", error: await created.text() };
        continue;
      }
      const ran = (await runAction({
        flow: copy,
        actionName: "answer",
        input: { note: input.note },
        userId: input.userId,
        orgId: DEFAULT_ORG_ID,
        sessionId: `s_${seatId}`,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      } as never)) as { output?: { said?: string }; error?: unknown };
      answers[seatId] = { declaredFlow, status: created.status, said: ran.output?.said ?? "", error: ran.error };
    }
  } finally {
    await state.dispose();
  }
  return { registered, found: true, answers };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as {
    userId: string;
    note: string;
    kind: string;
    seats: string[];
    workers: readonly WorkerManifest[];
  };
  const { answers } = await answerSeats({ ...input, kinds });
  process.stdout.write(
    `${JSON.stringify({
      kinds: Object.keys(kinds),
      answers: Object.fromEntries(Object.entries(answers).map(([id, row]) => [id, row.said])),
    })}\n`,
  );
}
