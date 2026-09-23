/**
 * FIX-1415 · Door B sketch — not production, not imported outside this POC.
 *
 * A worker kind would `uses: [createChannelAdminCapability({ ... })]`.
 * A seat would still name the verbs in `tools:`. These are catalog tools.
 * They are not `controlTools`. Empty `tools:` stays empty.
 *
 * The factory closes over a mint seam. That seam is Collab's to provide
 * (FIX-1341). This sketch does not call `channelInstances`, does not write a
 * `CHANNEL.md`, and does not register a flow kind.
 *
 * The verb names are the recommended cut. They are not locked — see
 * DECISIONS.md → Recommended, still open.
 */

import { defineCapability, handler } from "../../../../../packages/core/src/index";
import type { DefinedCapability } from "../../../../../packages/core/src/index";
import type { BlockContext } from "../../../../../packages/core/src/types";
import { z } from "zod";

/** What a Collab dynamic-room mint has to be able to do. Not a second inventory. */
export interface DynamicRoomMint {
  create(input: {
    orgId: string;
    channelId: string;
    kind: string;
    description: string;
    members: readonly string[];
  }): Promise<void>;
  delete(input: { orgId: string; channelId: string }): Promise<void>;
  invite(input: { orgId: string; channelId: string; seatId: string }): Promise<{ members: string[] }>;
  uninvite(input: { orgId: string; channelId: string; seatId: string }): Promise<{ members: string[] }>;
}

export interface ChannelAdminCapabilityOptions {
  /**
   * Ids opened from declaration (files or code). The tool cannot create,
   * delete, invite, or uninvite these. The lane is the origin, not a flag.
   */
  declaredIds: readonly string[];
  /**
   * Channel kinds already registered. Create may name one.
   * Omitted means only the built-in `"channel"`.
   */
  kinds?: readonly string[];
  mint: DynamicRoomMint;
}

const createInput = z
  .object({
    channelId: z.string().min(1),
    kind: z.string().min(1).default("channel"),
    description: z.string().min(1),
    members: z.array(z.string()).default([]),
  })
  .strict();

const channelIdInput = z.object({ channelId: z.string().min(1) }).strict();

const memberInput = z
  .object({
    channelId: z.string().min(1),
    seatId: z.string().min(1),
  })
  .strict();

const channelOutput = z.object({ channelId: z.string() });
const membersOutput = z.object({
  channelId: z.string(),
  members: z.array(z.string()),
});

function orgIdOf(ctx: BlockContext): string {
  const orgId = ctx.org?.identity.orgId;
  if (typeof orgId !== "string" || orgId.length === 0) {
    throw new Error("Channel admin is organization-scoped, and this principal names no organization.");
  }
  return orgId;
}

function refuseDeclared(channelId: string, declared: ReadonlySet<string>): void {
  if (declared.has(channelId)) {
    throw new Error(
      `"${channelId}" is a declared room. Create, delete, and membership changes apply only to rooms Collab minted. A declared room is opened from its file and is not deleted from a seat.`,
    );
  }
}

/**
 * Sketch factory. No resources of its own — the inventory and the channel
 * kind already exist. The dynamic ledger is the mint's, not a second registry.
 */
export function createChannelAdminCapability(
  options: ChannelAdminCapabilityOptions,
): DefinedCapability {
  const declared = new Set(options.declaredIds);
  const kinds = new Set(options.kinds ?? ["channel"]);

  const create = handler({
    name: "create",
    inputSchema: createInput,
    outputSchema: channelOutput,
    execute: async (input, ctx) => {
      const orgId = orgIdOf(ctx as BlockContext);
      refuseDeclared(input.channelId, declared);
      if (!kinds.has(input.kind)) {
        throw new Error(
          `This app carries no channel kind "${input.kind}". It carries: ${[...kinds].sort().join(", ")}.`,
        );
      }
      await options.mint.create({
        orgId,
        channelId: input.channelId,
        kind: input.kind,
        description: input.description,
        members: input.members,
      });
      return { channelId: input.channelId };
    },
  });

  const deleteRoom = handler({
    name: "delete",
    inputSchema: channelIdInput,
    outputSchema: channelOutput,
    execute: async (input, ctx) => {
      const orgId = orgIdOf(ctx as BlockContext);
      refuseDeclared(input.channelId, declared);
      await options.mint.delete({ orgId, channelId: input.channelId });
      return { channelId: input.channelId };
    },
  });

  const invite = handler({
    name: "invite",
    inputSchema: memberInput,
    outputSchema: membersOutput,
    execute: async (input, ctx) => {
      const orgId = orgIdOf(ctx as BlockContext);
      refuseDeclared(input.channelId, declared);
      const result = await options.mint.invite({
        orgId,
        channelId: input.channelId,
        seatId: input.seatId,
      });
      return { channelId: input.channelId, members: result.members };
    },
  });

  const uninvite = handler({
    name: "uninvite",
    inputSchema: memberInput,
    outputSchema: membersOutput,
    execute: async (input, ctx) => {
      const orgId = orgIdOf(ctx as BlockContext);
      refuseDeclared(input.channelId, declared);
      const result = await options.mint.uninvite({
        orgId,
        channelId: input.channelId,
        seatId: input.seatId,
      });
      return { channelId: input.channelId, members: result.members };
    },
  });

  return defineCapability({
    name: "channel-admin",
    presets: {
      verbs: {
        // Catalog grant. A consuming seat's `tools:` must name each verb.
        tools: [create, deleteRoom, invite, uninvite],
      },
      default: ["verbs"],
    },
  });
}
