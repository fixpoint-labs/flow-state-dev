/**
 * Goal check — an orchestrator seat routes a task to a workforce it never saw.
 *
 * A hired seat, a real model, and a system prompt that names nobody. The
 * orchestrator is told there is work and told to look; everything it knows
 * about who exists comes back through the `discover` tool at the moment it
 * asks. It then assigns, and the assignment is graded against the fixture.
 *
 * Two runs, and the pair is the point:
 *
 *   1. **Live** — the seats' purposes are as their files declare them. The
 *      orchestrator must reach the one seat whose purpose answers the task.
 *   2. **Control** — the identical run with every purpose blanked. It must
 *      NOT reach that seat. A goal check whose red state was never produced is
 *      not evidence, and this is the red state: the seat ids are opaque
 *      (`delta.one`, `sigma.one`), so with the purposes gone there is nothing
 *      in the catalog to route on and any hit is a coin flip.
 *
 * Real path, real model, no mocking. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/agent-discovery/an-orchestrator-routes-a-task-by-asking/run.mts
 */
import { defineCapability, defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createInMemoryStores, createModelResolver, runAction } from "@flow-state-dev/engine";
import {
  createWorkforceCapability,
  defineAgentWorkerFlow,
  defineSeatInventoryCollection,
  hireWorkforce,
  type WorkerManifest,
} from "@flow-state-dev/workforce";
import { z } from "zod";
import {
  DEFAULT_MODEL,
  goalAttempts,
  goalSessionId,
  loadFixture,
  runGoal,
  silentLogger,
  stripIntentOverrides,
} from "../../lib/index.mts";

type Seat = { id: string; kind: string; purpose: string };
type Fixture = {
  seats: Seat[];
  task: string;
  expectedSeat: string;
  orchestrator: { id: string; instructions: string };
};

const fx = loadFixture<Fixture>(import.meta.url);

// A bare createModelResolver rejects an intent ladder it never declared; clear
// the env override so it auto-wires the AI Gateway from AI_GATEWAY_API_KEY.
stripIntentOverrides();

const SEAT_INVENTORY_KEY = "seatInventory";

/** The live inventory, mounted on whoever needs to read or write it. */
const inventoryMount = defineCapability({
  name: "inventory-mount",
  resources: { [SEAT_INVENTORY_KEY]: defineSeatInventoryCollection() },
});

/**
 * The seat records as the tree declares them — what `readDeclaredRoster` would
 * hand back. Built from the fixture so swapping it still grades correctly.
 *
 * `blankPurposes` is the control: the SAME records with `description` emptied.
 * Nothing else differs between the two runs, so a difference in where the task
 * lands is attributable to the purpose line and to nothing else.
 */
function rosterFrom(seats: Seat[], blankPurposes: boolean): WorkerManifest[] {
  return seats.map((seat) => ({
    id: seat.id,
    declared: blankPurposes ? {} : { description: seat.purpose },
    body: "",
  }));
}

/** Where the model's routing decision lands. A real side effect, not a parse. */
function assignTool() {
  const assigned: string[] = [];
  const assign = handler({
    name: "assign",
    description: "Assign this task to one seat, by the exact id you read from `discover`.",
    inputSchema: z.object({
      seatId: z.string().describe("The seat's id, exactly as `discover` returned it."),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: (input: { seatId: string }) => {
      assigned.push(input.seatId);
      return { ok: true };
    },
  });
  return { assign, assigned };
}

/** A flow that can write the live inventory rows the real collection holds. */
const seedInventory = handler({
  name: "seed-inventory",
  inputSchema: z.object({ seats: z.array(z.object({ id: z.string(), kind: z.string() })) }),
  outputSchema: z.object({ written: z.number() }),
  resources: { [SEAT_INVENTORY_KEY]: defineSeatInventoryCollection() },
  execute: async (input: { seats: { id: string; kind: string }[] }, ctx: any) => {
    for (const row of input.seats) {
      await ctx.resources[SEAT_INVENTORY_KEY].upsert(row.id, row);
    }
    return { written: input.seats.length };
  },
});

const seeder = defineFlow({
  kind: "inventory-seeder",
  actions: { seed: { block: seedInventory as never } },
})();

/** One whole run: hire the workforce, seed its rows, give the coordinator the task. */
async function route(blankPurposes: boolean): Promise<{
  assigned: string[];
  prompt: string;
  error?: string;
}> {
  const { assign, assigned } = assignTool();
  const roster = rosterFrom(fx.seats, blankPurposes);

  const kind = defineAgentWorkerFlow({
    model: DEFAULT_MODEL,
    catalog: { assign },
    uses: [
      inventoryMount,
      createWorkforceCapability({
        roster: { workers: roster, channels: [] },
        inventory: { seats: SEAT_INVENTORY_KEY },
      }),
    ],
  });

  // The coordinator is hired from a record like any other seat. Its file names
  // its tool and its instructions; it names NO seat and no roster.
  const coordinatorRecord: WorkerManifest = {
    id: fx.orchestrator.id,
    declared: { tools: ["assign"] },
    body: fx.orchestrator.instructions,
  };
  const [coordinator] = hireWorkforce([coordinatorRecord], {
    kinds: { agent: kind as never },
  });
  if (!coordinator) return { assigned, prompt: "", error: "the coordinator was not hired" };

  const stores = createInMemoryStores();
  const runtimeConfig = {
    modelResolver: createModelResolver(),
    logger: silentLogger,
  } as never;
  const session = goalSessionId(blankPurposes ? "discovery-control" : "discovery-live");

  // The rows the door reads. Written through the real collection by a real
  // action on a different flow, in the same org — which is what makes them
  // readable by the coordinator at all.
  const seeded = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow: seeder,
    actionName: "seed" as never,
    input: { seats: fx.seats.map((seat) => ({ id: seat.id, kind: seat.kind })) },
    userId: "goal-user",
    sessionId: `${session}-seed`,
    stores,
    runtimeConfig,
  });
  if (seeded.error) return { assigned, prompt: "", error: `seeding failed: ${seeded.error.message}` };

  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow: { ...coordinator, cardinality: "singleton" } as never,
    actionName: "run" as never,
    input: { message: fx.task },
    userId: "goal-user",
    sessionId: session,
    stores,
    runtimeConfig,
  });

  return {
    assigned,
    prompt: coordinatorRecord.body,
    ...(result.error ? { error: result.error.message } : {}),
  };
}

await runGoal(async () => {
  const failures: string[] = [];

  // Honesty guards, before a model is spent.

  // 1. The whole claim is that the coordinator learned the roster from the
  // door — so the roster must not be anywhere in what it was given to start
  // with.
  const seeded = [fx.task, fx.orchestrator.instructions].join(" ").toLowerCase();
  for (const seat of fx.seats) {
    if (seeded.includes(seat.id.toLowerCase())) {
      return {
        failures: [`setup invalid: seat id "${seat.id}" leaked into the task or the instructions`],
        evidence: "",
      };
    }
  }

  // 2. The expected seat must not be the one a model with NO signal would
  // reach anyway. The door returns entries sorted by id, and the first
  // version of this fixture put the answer first — the control routed to it
  // with every purpose blanked, which is a coin flip wearing a verdict. Kept
  // as a check rather than a comment so the fixture cannot drift back.
  const byId = [...fx.seats].map((seat) => seat.id).sort((a, b) => a.localeCompare(b));
  if (byId[0] === fx.expectedSeat) {
    return {
      failures: [
        `setup invalid: "${fx.expectedSeat}" sorts first, so the control cannot tell ` +
          `"routed on purpose" from "picked the first entry"`,
      ],
      evidence: "",
    };
  }
  if (fx.seats.length < 5) {
    return {
      failures: [
        `setup invalid: ${fx.seats.length} seats makes the blanked-purpose baseline ` +
          `1 in ${fx.seats.length} — too high for the control to mean anything`,
      ],
      evidence: "",
    };
  }

  // The live run. Retried, because model judgment is probabilistic — the retry
  // is of the MODEL's call, never of the mechanism.
  let live: Awaited<ReturnType<typeof route>> | undefined;
  const attempts = goalAttempts();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    live = await route(false);
    if (live.error === undefined && live.assigned.includes(fx.expectedSeat)) break;
  }
  if (live === undefined) return { failures: ["the live run never executed"], evidence: "" };
  if (live.error) failures.push(`live run errored: ${live.error}`);

  if (live.assigned.length === 0) {
    failures.push("the coordinator never called `assign` — it did not route at all");
  } else if (live.assigned[0] !== fx.expectedSeat) {
    failures.push(
      `the coordinator assigned "${live.assigned[0]}", but the task is answered by ` +
        `"${fx.expectedSeat}"'s purpose`,
    );
  }

  // The coordinator's own prompt names nobody. Asserted rather than assumed:
  // a run where the roster had leaked into the prompt would route correctly
  // and prove nothing about the door.
  for (const seat of fx.seats) {
    if (live.prompt.toLowerCase().includes(seat.id.toLowerCase())) {
      failures.push(`seat "${seat.id}" appeared in the coordinator's own prompt`);
    }
  }

  // The control. One run, no retry: a retry here would be fishing for the miss
  // that makes the control pass.
  const control = await route(true);
  if (control.error) failures.push(`control run errored: ${control.error}`);
  if (control.assigned[0] === fx.expectedSeat) {
    failures.push(
      `CONTROL FAILED: with every purpose blanked the coordinator still reached ` +
        `"${fx.expectedSeat}". Something other than the purpose line is routing this task, ` +
        `so the live run is not evidence.`,
    );
  }

  return {
    failures,
    evidence:
      `live: assigned ${JSON.stringify(live.assigned)} (expected "${fx.expectedSeat}") from a ` +
      `prompt naming no seat; control with purposes blanked: ` +
      `${JSON.stringify(control.assigned)}`,
  };
});
