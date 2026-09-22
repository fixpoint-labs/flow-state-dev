/**
 * FIX-1480 · Door B sketch — not production, not imported outside this POC.
 *
 * A worker kind would `uses: [createSeatHireCapability({ kinds, register, unregister })]`.
 * A seat would still name `hire` / `fire` in `tools:`. These are catalog tools.
 * They are not `controlTools`. Empty `tools:` stays empty.
 *
 * The factory closes over the host seams the admin flow already uses. It does
 * not dispatch kitchen-sink's admin action (that would be a KS-only API).
 */

import { defineCapability, handler } from "../../../../../packages/core/src/index";
import type { DefinedCapability } from "../../../../../packages/core/src/index";
import type { FlowInstance, FlowType } from "../../../../../packages/core/src/types";
import { z } from "zod";
import {
  defineHiredRosterCollection,
  hiredSeatManifest,
  hireWorkforce,
  seatAddress,
  toHiredSeatRow,
} from "../../../../../packages/workforce/src/index";

export interface SeatHireCapabilityOptions {
  /** The same kinds map `hireWorkforce` already takes. */
  kinds: Record<string, FlowType>;
  /** Host admission — `FlowState.register` in production. */
  register: (seat: FlowInstance) => void;
  /** Host release — `FlowState.unregister` in production. */
  unregister: (id: string) => void;
  /**
   * Optional subset of `kinds` this tool may name.
   * Omitted means every registered kind is hireable.
   * Not a Role.
   */
  hireableKinds?: readonly string[];
}

const hireInput = z.object({
  seatId: z.string().min(1),
  flow: z.string().min(1),
  settings: z.record(z.unknown()).default({}),
  instructions: z.string().optional(),
});

const hireOutput = z.object({
  seatId: z.string(),
  address: z.string(),
});

const fireInput = z.object({ seatId: z.string().min(1) });
const fireOutput = z.object({
  seatId: z.string(),
  address: z.string(),
});

/**
 * Sketch factory. Resources install the existing roster collection — no second
 * store. Inventory write is [D1](../../DECISIONS.md#d1), not in this sketch.
 */
export function createSeatHireCapability(
  options: SeatHireCapabilityOptions,
): DefinedCapability {
  const roster = defineHiredRosterCollection();
  const kindNames = Object.keys(options.kinds).sort();
  const hireable = new Set(options.hireableKinds ?? kindNames);

  const hire = handler({
    name: "hire",
    inputSchema: hireInput,
    outputSchema: hireOutput,
    execute: async (input, ctx) => {
      const orgId = ctx.org?.identity.orgId ?? ctx.org?.identity.id;
      if (typeof orgId !== "string" || orgId.length === 0) {
        throw new Error("Hire is organization-scoped, and this principal names no organization.");
      }
      if (!Object.hasOwn(options.kinds, input.flow) || !hireable.has(input.flow)) {
        throw new Error(
          `This app carries no hireable flow kind "${input.flow}". It carries: ${[...hireable].sort().join(", ")}.`,
        );
      }
      const address = seatAddress(orgId, input.seatId);
      const row = toHiredSeatRow({
        seatId: input.seatId,
        flow: input.flow,
        settings: input.settings,
        instructions: input.instructions ?? null,
      });
      const { manifest } = hiredSeatManifest(orgId, row);
      const [seat] = hireWorkforce([manifest], { kinds: options.kinds });
      if (seat === undefined) {
        throw new Error(`"${address}" could not be hired.`);
      }
      // Existing roster, `create()` is the duplicate refusal — same as host admin.
      await (ctx.resources as { roster: { create: (k: string, v: unknown) => Promise<unknown> } }).roster.create(
        input.seatId,
        row,
      );
      options.register(seat);
      return { seatId: input.seatId, address };
    },
  });

  const fire = handler({
    name: "fire",
    inputSchema: fireInput,
    outputSchema: fireOutput,
    execute: async (input, ctx) => {
      const orgId = ctx.org?.identity.orgId ?? ctx.org?.identity.id;
      if (typeof orgId !== "string" || orgId.length === 0) {
        throw new Error("Fire is organization-scoped, and this principal names no organization.");
      }
      const address = seatAddress(orgId, input.seatId);
      await (ctx.resources as { roster: { delete: (k: string) => Promise<unknown> } }).roster.delete(
        input.seatId,
      );
      options.unregister(address);
      return { seatId: input.seatId, address };
    },
  });

  return defineCapability({
    name: "seat-hire",
    resources: { roster },
    presets: {
      verbs: {
        // Catalog grant. A consuming seat's `tools:` must name `hire` / `fire`.
        tools: [hire, fire],
      },
      default: ["verbs"],
    },
  });
}
