/**
 * Goal check — a hired seat cannot join the live roster without an owner pin.
 *
 * Three legs. (a) is the refuse: no pin, nothing admitted. (b) is the hire
 * tool: a manager names `hire` and the live roster records the pin from the
 * roster cell, not a guess. (c) is pin ≠ address: a seat whose id reads like
 * another org still carries the pin it was given.
 *
 * Real path, no model. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/seat-hire/refuses-an-unpinned-register/run.mts
 */
import {
  createSeatHireCapability,
  defineAgentWorkerFlow,
  hireWorkforce,
  registerHiredSeat,
  type HiredSeatOwnerPin,
  type HireOptions,
  type WorkerManifest,
} from "@flow-state-dev/workforce";
import type { FlowInstance } from "@flow-state-dev/core";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { loadFixture, runGoal, stripIntentOverrides } from "../../lib/index.mts";

type Fixture = {
  orgId: string;
  otherOrg: string;
  managerId: string;
  seatId: string;
  unpinnedSeat: string;
  foreignSeat: string;
};

stripIntentOverrides();

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";

function liveRoster() {
  const held = new Map<string, { seat: FlowInstance; pin?: HiredSeatOwnerPin }>();
  return {
    register(seat: FlowInstance, pin: HiredSeatOwnerPin) {
      if (held.has(seat.id)) {
        throw new Error(`"${seat.id}" is already registered`);
      }
      held.set(seat.id, { seat, pin });
    },
    unregister(id: string) {
      return held.delete(id);
    },
    kindAt(id: string) {
      return held.get(id)?.seat.kind;
    },
    pinAt(id: string) {
      return held.get(id)?.pin;
    },
    has(id: string) {
      return held.has(id);
    },
  };
}

function admit(
  register: (seat: FlowInstance, pin: HiredSeatOwnerPin) => void,
  seat: FlowInstance,
  pin: HiredSeatOwnerPin | undefined,
): void {
  if (CONTROL === "unpinned-ok") {
    register(seat, pin as HiredSeatOwnerPin);
    return;
  }
  registerHiredSeat(register, seat, pin);
}

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

function hireReturn(items: unknown[]): { seatId?: string; address?: string } | undefined {
  const visit = (value: unknown): { seatId?: string; address?: string } | undefined => {
    if (value === null || typeof value !== "object") return undefined;
    const row = value as Record<string, unknown>;
    if (typeof row.seatId === "string" && typeof row.address === "string") {
      return { seatId: row.seatId, address: row.address };
    }
    for (const nested of Object.values(row)) {
      const found = visit(nested);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  for (const item of items) {
    const found = visit(item);
    if (found !== undefined) return found;
  }
  return undefined;
}

await runGoal(async () => {
  if (fixture.orgId === fixture.otherOrg) {
    return {
      failures: [
        `the fixture's orgId and otherOrg are both "${fixture.orgId}" — leg (c) has nothing to grade`,
      ],
      evidence: "",
    };
  }
  if (fixture.unpinnedSeat === fixture.seatId) {
    return {
      failures: [
        `the fixture's unpinnedSeat and seatId are both "${fixture.seatId}" — admitting the unpinned seat would take the hire's address`,
      ],
      evidence: "",
    };
  }

  const failures: string[] = [];
  const evidence: string[] = [];
  const live = liveRoster();
  const stray = { id: `${fixture.orgId}.${fixture.unpinnedSeat}`, kind: "agent" } as FlowInstance;

  // ---- (a) unpinned register leaves the address empty ----------------------
  let threw = false;
  try {
    admit(live.register, stray, undefined);
  } catch (error) {
    threw = String(error).includes("owner pin");
    if (!threw) {
      failures.push(
        `leg (a): the refuse threw ${JSON.stringify(String(error))} rather than naming the owner pin`,
      );
    }
  }
  if (!threw) {
    failures.push("leg (a): registerHiredSeat admitted a hired seat with no pin");
  }
  if (live.has(stray.id)) {
    failures.push(
      `leg (a): ${stray.id} is live after an unpinned register — the address must stay empty`,
    );
  }

  // ---- (b) hire pins the roster owner --------------------------------------
  const kinds: NonNullable<HireOptions["kinds"]> = {};
  const seatHire = createSeatHireCapability({
    kinds,
    register: live.register,
    unregister: live.unregister,
    kindAt: live.kindAt,
  });
  kinds.agent = defineAgentWorkerFlow({ uses: [seatHire] });

  const [manager] = hireWorkforce(
    [record({ id: fixture.managerId, declared: { tools: ["hire"] }, body: "Expands the roster." })],
    { kinds },
  );
  if (manager === undefined) {
    return { failures: ["leg (b): hireWorkforce minted no manager"], evidence: "" };
  }

  const runtime = await createTestContext({
    flow: { ...manager, cardinality: "singleton" },
    orgId: fixture.orgId,
    org: { state: {} },
    sessionId: "goal-session",
    sequencerName: manager.actions.run!.block.name,
    declaredResources: manager.actions.run!.block.declaredResources,
    generators: {
      "agent-answer": mockGenerator({
        name: "agent-answer",
        script: [
          {
            toolCalls: [
              {
                toolCallId: "hire-1",
                toolName: "hire",
                args: { seatId: fixture.seatId, flow: "agent" },
              },
            ],
          },
          { text: "done" },
        ] as never,
      }),
    },
  });
  const hired = await executeBlock({
    block: manager.actions.run!.block,
    input: { message: "hire the named seat" },
    ctx: runtime.ctx,
  });

  const address = `${fixture.orgId}.${fixture.seatId}`;
  const payload = hireReturn(hired.items);
  if (hired.error !== undefined) {
    failures.push(`leg (b): hire failed: ${hired.error.message}`);
  }
  if (payload?.address !== address || payload.seatId !== fixture.seatId) {
    failures.push(
      `leg (b): hire returned ${JSON.stringify(payload)}, wanted { seatId: "${fixture.seatId}", address: "${address}" }`,
    );
  }
  if (!live.has(address)) {
    failures.push(`leg (b): ${address} is not live after hire`);
  }
  const hirePin = live.pinAt(address);
  if (hirePin?.orgId !== fixture.orgId) {
    failures.push(
      `leg (b): hire pinned ${JSON.stringify(hirePin)}, wanted { orgId: "${fixture.orgId}" } from the roster cell`,
    );
  }

  // ---- (c) pin is not parsed from the address ------------------------------
  const foreignId = `${fixture.otherOrg}.${fixture.foreignSeat}`;
  const foreign = { id: foreignId, kind: "agent" } as FlowInstance;
  const foreignPin =
    CONTROL === "pin-from-address"
      ? { orgId: foreignId.split(".")[0] ?? "" }
      : { orgId: fixture.orgId };
  admit(live.register, foreign, foreignPin);
  const recorded = live.pinAt(foreignId);
  if (recorded?.orgId !== fixture.orgId) {
    failures.push(
      `leg (c): ${foreignId} recorded pin ${JSON.stringify(recorded)}, wanted { orgId: "${fixture.orgId}" } — ` +
        `the first address segment is "${fixture.otherOrg}" and must not win`,
    );
  }
  if (recorded?.orgId === fixture.otherOrg) {
    failures.push(
      `leg (c): the pin was parsed from the address (${fixture.otherOrg}) rather than taken from the hire row`,
    );
  }

  evidence.push(
    `unpinned ${stray.id} stayed empty; hire of ${address} pinned ${JSON.stringify(hirePin)}; ` +
      `${foreignId} carried ${JSON.stringify(recorded)}`,
  );
  return { failures, evidence: evidence.join("; ") };
});
