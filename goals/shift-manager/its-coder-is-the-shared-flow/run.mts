/**
 * Goal: shift-manager › its coder is the shared flow (FIX-2877, leg b).
 *
 * Shift Manager's coder is the harness kit's `coder` flow, and one value picks
 * the coder that runs. For each of two scripted harness ids, the Lab is opened
 * with that id as its `defaultHarness`, and the coordinator files one question
 * for `eng.coder`, whose `WORKER.md` names no harness. The task must run on
 * that id's agent and no other, in a `coder` flow session that reports that id.
 * The readiness view must list exactly the harnesses the coder runs, and a hire
 * naming an id outside them must be refused with exactly those ids.
 *
 * What ran is read from each scripted agent's own run log, the stored task and
 * the run's own session, never from a reply. The coordinator's judgment is
 * scripted (one `createTask` per message); no model.
 *
 * Control (`GOAL_CONTROL`): `default-ignored` patches the kit so a worker
 * naming no harness runs on the first one filled, whatever `defaultHarness`
 * says. Must fail `b:ran-on-default`.
 *
 * Run: pnpm tsx goals/shift-manager/its-coder-is-the-shared-flow/run.mts
 */
process.env.FSDEV_TRACE_OBSERVABILITY = "0";
delete process.env.FSDEV_DEFAULT_MODEL;

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { harnessStub, type HarnessStub } from "@flow-state-dev/harness-manager";
import { harnessReadinessViewRef } from "@flow-state-dev/harness-manager/browser";
import { CODER_FLOW } from "@flow-state-dev/harness-manager/kit";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, loadFixture, modulePatchEnv, runGoal, silentLogger, type ModulePatch } from "../../lib/index.mts";
import { connect } from "../../../packages/shift-manager/src/lib/connection.ts";
import { readyHarness } from "../../../packages/shift-manager/teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USERS, openLab, type Lab } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { createBareRemote } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";
import { serveLab, type ServedLab } from "../../../packages/shift-manager/test/helpers/serve-lab.ts";

interface Fixture {
  /** Two scripted harness ids, each the Lab's default in turn. Any two distinct ids pass the same way. */
  ids: [string, string];
  /** An id the Lab doesn't run, for the hire that must be refused. */
  outsideId: string;
  /** The question the coordinator files for the coder. */
  ask: string;
  /** The user's message the coordinator files it from. */
  message: string;
}
const fixture = loadFixture<Fixture>(import.meta.url);
const SCRATCH = goalTmpDir("its-coder-is-the-shared-flow");
const OWNER = LAB_USERS.owner;
const STOREFRONT = { visibility: "shared", id: "storefront" } as const;

// ---- control: a scratch patch, applied in a child that loads it ----------------

const CONTROLS: Record<string, { patches: ModulePatch[]; must: string[] }> = {
  "default-ignored": {
    must: ["b:ran-on-default"],
    patches: [
      {
        module: "packages/harness-manager/src/kit/coder-flow.ts",
        from: String.raw`const id = \(worker\.config\.harness as string \| undefined\) \?\? options\.defaultHarness;`,
        to: "const id = (worker.config.harness as string | undefined) ?? Object.keys(harnesses)[0];",
      },
    ],
  },
};
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const { patches, must } = CONTROLS[CONTROL]!;
  console.error(describePatches(patches, REPO_ROOT));
  mkdirSync(SCRATCH, { recursive: true });
  const mark = join(SCRATCH, `patched-${RUN_STAMP}`);
  const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, ...modulePatchEnv(patches, REPO_ROOT, mark) },
    encoding: "utf8",
  });
  process.stdout.write(child.stdout ?? "");
  process.stderr.write(child.stderr ?? "");
  assertPatched(patches, REPO_ROOT, mark);
  const out = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  const failedOn = must.filter((assertion) => /^FAIL/m.test(out) && out.includes(`${assertion} —`));
  console.log(
    failedOn.length > 0
      ? `control ${CONTROL}: failed on ${failedOn.join(", ")}, as it must`
      : `control ${CONTROL}: did NOT fail on any of ${must.join(", ")}, so the check can't see what the control removes`,
  );
  process.exit(failedOn.length > 0 ? 0 : 1);
}

/** The coordinator's judgment: the user's message is filed once, for `eng.coder`, with no harness named; every other step stops. */
function filing(): ModelResolver {
  let filed = false;
  const judgment: GeneratorModel = {
    modelId: "goal/judgment",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { messages?: unknown[] }) {
      if (filed || !JSON.stringify(options.messages ?? []).includes(fixture.message)) return { text: "Filed.", finishReason: "stop" };
      filed = true;
      return {
        toolCalls: [{ toolCallId: "t1", toolName: "createTask", args: { goal: fixture.ask, assignee: "eng.coder", input: { project: STOREFRONT } } }],
        finishReason: "tool-calls",
      };
    },
  };
  return Object.assign(
    (_id: string, block?: string) => {
      if (block?.startsWith("coordinator-judgment")) return judgment;
      throw new Error(`no model in this goal (asked for ${block ?? "a block"})`);
    },
    {
      resolveId: (id: string) => id,
      resolveEvaluationModel: () => ({
        specificationVersion: "v4",
        provider: "goal",
        modelId: "goal/route",
        supportedQuestionTypes: ["choice", "score", "boolean"],
        async doEvaluate() {
          throw new Error("no route in this goal");
        },
      }),
    },
  ) as unknown as ModelResolver;
}

async function act(lab: Lab, flow: string, sessionId: string, actionName: string, input: unknown) {
  const runtime = await lab.state.getRuntime();
  return (await runAction({
    orgId: LAB_ORG_ID,
    flow: runtime.registry.get(flow) as FlowInstance,
    actionName,
    input,
    userId: OWNER.userId,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  } as never)) as { output?: any; error?: unknown };
}

/** Poll `check` until it answers, or `undefined` after `ms`. */
async function within<T>(ms: number, check: () => Promise<T | undefined>): Promise<T | undefined> {
  for (const until = Date.now() + ms; Date.now() < until; await new Promise((r) => setTimeout(r, 100))) {
    const value = await check();
    if (value !== undefined) return value;
  }
  return undefined;
}

await runGoal(async (failures, tell) => {
  const fail = (assertion: string, why: string) => failures.push(`${assertion} — ${why}`);
  const evidence: string[] = [];
  for (const id of fixture.ids) {
    const stubs: Record<string, HarnessStub> = Object.fromEntries(fixture.ids.map((name) => [name, harnessStub({ finalMessage: `ran on ${name}` })]));
    const remote = createBareRemote(`shared-flow-${id}`, { seed: { "README.md": "storefront\n" } });
    const lab = await openLab({
      modelResolver: filing(),
      stores: inMemoryStores(),
      harnesses: fixture.ids.map((name) => readyHarness(stubs[name]!.slot, name)),
      defaultHarness: id,
      runTimeoutMs: 30_000,
      workspace: { root: mkdtempSync(join(tmpdir(), "its-coder-is-the-shared-flow-")), remotes: { allow: ["file"] } },
      coderWorkerId: "eng.coder",
      inventory: true,
      withoutJudge: true,
      logger: silentLogger,
      projects: [{ id: STOREFRONT.id, title: "Storefront", repository: remote.url }],
    });
    let served: ServedLab | undefined;
    try {
      const sessionId = `s-shift-coordinator-${globalThis.crypto.randomUUID()}`;
      const created = await lab.door("POST", "coordinator/sessions", { body: { userId: OWNER.userId, sessionId, state: { workerId: "shift-coordinator" } } });
      if (created.status !== 201) {
        fail(`b:${id}:setup`, `the conversation was not created (${created.status})`);
        continue;
      }
      const said = await act(lab, "coordinator", sessionId, "respond", { message: fixture.message });
      if (said.error !== undefined) fail(`b:${id}:setup`, `the message was refused: ${String(said.error)}`);
      // The stored task the conversation filed, read from the store once it has ended.
      const task = await within(30_000, async () => {
        const filed = (Object.values(await lab.stored("user", "tasks/")) as Array<Record<string, any>>).find((stored) => stored.filer?.sessionId === sessionId);
        return ["completed", "errored", "cancelled", "failed"].includes(filed?.status) ? filed : undefined;
      });
      if (task === undefined) {
        fail(`b:${id}:settled`, "the coder's task did not settle in 30 s");
        continue;
      }
      // The default ran the task, and no other harness did: each agent's own run log, and the stored answer.
      const ran = tell.over(`b · ${id} · runs per harness`, Object.entries(stubs).filter(([, stub]) => stub.runs.length > 0).map(([name]) => name));
      if (task.status !== "completed" || task.output?.answer !== `ran on ${id}` || ran.join() !== id) {
        fail("b:ran-on-default", `with defaultHarness "${id}" the task ${task.status}, answered ${JSON.stringify(task.output?.answer)}, and ran on [${ran.join(", ")}]`);
      } else {
        evidence.push(`with defaultHarness "${id}", eng.coder (no harness line) ran its task on ${id} only`);
      }
      // A `coder` flow run: the run's own session is the kit's coder flow, and it reports the harness it runs.
      const session = (await (await lab.state.getRuntime()).stores.session.get(task.run.sessionId)) as { flowKind?: string; flow?: string } | null;
      const reported = await act(lab, CODER_FLOW, task.run.sessionId, "harness", {});
      if (reported.error !== undefined || reported.output?.harness !== id) {
        fail("b:coder-flow-run", `the run's session ${task.run.sessionId} (${JSON.stringify(session?.flowKind ?? session?.flow)}) answered the kit's harness read with ${JSON.stringify(reported.output ?? String(reported.error))}`);
      } else {
        evidence.push(`its run session is a ${CODER_FLOW} flow session reporting ${id}`);
      }

      // Readiness lists exactly the harnesses the coder runs, and a hire outside them is refused with exactly those ids.
      served = await serveLab(lab.state);
      const client = connect({ userId: OWNER.userId, baseUrl: served.baseUrl, bearerToken: OWNER.bearer });
      const entries = (await client.view(harnessReadinessViewRef("harnesses"), {})).value.map((entry) => entry.harness);
      if (JSON.stringify(entries) !== JSON.stringify(fixture.ids)) fail("b:readiness-equals-coder", `readiness lists [${entries.join(", ")}], the coder runs [${fixture.ids.join(", ")}]`);
      const workforce = createWorkforceClient(connect({ userId: OWNER.userId, baseUrl: served.baseUrl, bearerToken: OWNER.bearer }));
      const refusal = await workforce
        .hire({ id: `${fixture.outsideId}-coder`, flow: CODER_FLOW, settings: { document: "teams/eng/feature-brief", harness: fixture.outsideId } })
        .then(() => undefined, (error: Error) => error.message);
      const named = [...(refusal ?? "").matchAll(/'([^']+)'/g)].map((match) => match[1]).filter((name) => name !== fixture.outsideId);
      if (refusal === undefined) fail("b:hire-refused", `a hire on "${fixture.outsideId}" landed`);
      else if (JSON.stringify(named) !== JSON.stringify(entries)) fail("b:hire-refused", `the refusal names [${named.join(", ")}], readiness lists [${entries.join(", ")}]: ${refusal}`);
      else evidence.push(`readiness lists [${entries.join(", ")}], and a hire on ${fixture.outsideId} is refused naming exactly those`);
    } finally {
      await served?.handle.close();
      await lab.dispose();
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
