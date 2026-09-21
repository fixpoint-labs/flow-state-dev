/**
 * ChannelFlow — the one channel kind the framework ships.
 *
 * The identity rule this whole module is built around: **one kind is one
 * instance, and one channel is one named session on it.** The flow declares
 * `cardinality: "singleton"`, so the registry admits exactly one instance and
 * its address is the kind (`flow.id === flow.kind`). A hundred channels are a
 * hundred sessions on that one instance; what differs per channel — its
 * members, its charter and its transcript — lives in that session's own state,
 * which is the framework's existing home for durable per-session facts.
 *
 * A factory rather than a bare flow because a block cannot ride in a
 * zod-parsed config bag, and `options.notify` is a block. `channelFlow` is the
 * built-in the binder seeds.
 *
 * What the transcript can prove, said once here so no reader has to infer it: a
 * session is bound to ONE user, so the server-derived `principal` on every line
 * of a given channel is the SAME value. The `author` label is caller-supplied,
 * stored with `authorVerified: false`, and is the only thing distinguishing
 * participants. The members check on `author` is a validity check against the
 * declared roster, not authentication.
 */

import { defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";
import { taskSchema } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import {
  channelBoardId,
  channelBoardLedger,
  channelBoardNamesFor,
  resolveChannelBoard
} from "./channel-board";
import {
  defineChannelInventoryCollection,
  defineMembershipIndexCollection,
  defineSeatInventoryCollection,
  membershipKey,
  seatInventoryRowSchema
} from "../inventory/collections";

/** The built-in kind's name, and so the built-in instance's address. */
export const CHANNEL_KIND = "channel";

/** One line of a channel's transcript. Append-only; never rewritten. */
export const channelTranscriptLineSchema = z.object({
  /** Stable per-line id, minted at append. */
  id: z.string(),
  /** Epoch milliseconds at append. */
  at: z.number(),
  /**
   * The server-derived identity the post ran under. Constant for a given
   * channel — see the module header. Never caller-supplied.
   */
  principal: z.string(),
  /** The poster's claim about which seat wrote the line. Unverified. */
  author: z.string().optional(),
  /**
   * Always `false` in this floor. Spelled out rather than omitted so a reader
   * of a stored line cannot mistake the `author` field for a proven one.
   */
  authorVerified: z.literal(false),
  body: z.string()
});

export type ChannelTranscriptLine = z.infer<typeof channelTranscriptLineSchema>;

/**
 * The session state every channel on one instance shares.
 *
 * `members` and `instructions` are REQUIRED, and that is load-bearing rather
 * than incidental: a session the action path created (which writes empty state
 * and applies no schema defaults) carries neither, and that absence is exactly
 * what `channel-not-bound` tests. Giving either a `.default()` would make every
 * unbound session look like an empty channel.
 *
 * State and not metadata, deliberately: `SessionRecord.metadata`, `topic` and
 * `coordinate` carry no authority by declared contract, and `members` is read
 * on a refusal path.
 */
export const channelSessionStateSchema = z.object({
  /** The declared roster. Written once at open; read-only on the post path. */
  members: z.array(z.string()),
  /** The channel's charter — the `CHANNEL.md` body. */
  instructions: z.string(),
  transcript: z.array(channelTranscriptLineSchema).default([])
});

export type ChannelSessionState = z.infer<typeof channelSessionStateSchema>;

/** What a caller may put in a post. Closed: a caller has nowhere to put a `principal`. */
export const channelPostInputSchema = z
  .object({
    body: z.string().min(1),
    /** Optional, unverified claim about which seat is posting. */
    author: z.string().optional()
  })
  .strict();

export type ChannelPostInput = z.infer<typeof channelPostInputSchema>;

/** What `read` projects: the channel, not the session's machinery. */
export const channelReadOutputSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  members: z.array(z.string()),
  /**
   * The board NAMES this channel declared — never the rows, which are a board
   * read. **Absent, not `[]`, on a channel that declares none**, so a channel
   * without boards projects exactly what it projected before boards existed.
   */
  boards: z.array(z.string()).optional(),
  transcript: z.array(channelTranscriptLineSchema)
});

export type ChannelReadOutput = z.infer<typeof channelReadOutputSchema>;

/**
 * Why a call on a channel was refused. Every one is a per-request refusal that
 * leaves the transcript — and the ledger — untouched.
 *
 * `board-not-declared` is the file path's own: a caller naming a board this
 * channel's `CHANNEL.md` did not declare. It is never another channel's board
 * being reached and refused, because the ledger id is minted from the
 * session's own identity and a name can only ever address this channel's.
 *
 * `board-needs-an-org` is the one a channel opened without an `orgId` meets.
 * A board is org-scoped storage, so there is no scope to read or write in and
 * the refusal says that rather than letting the resource registry report the
 * board as unregistered, which sends an author to check a registration that is
 * fine. Same shape as an org-scoped document read in an org-less channel.
 */
export type ChannelRefusalReason =
  | "channel-not-bound"
  | "author-not-a-member"
  | "board-not-declared"
  | "board-needs-an-org";

/**
 * A post refused on the channel's own terms, as opposed to by the substrate.
 *
 * Carries `reason` so a caller can branch without matching on message text —
 * the same shape the dispatch seam's refusals use.
 */
export class ChannelPostRefusedError extends Error {
  readonly reason: ChannelRefusalReason;

  constructor(reason: ChannelRefusalReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = "ChannelPostRefusedError";
    this.reason = reason;
  }
}

/**
 * Is this session a bound channel, or merely a session that exists?
 *
 * The shared instance answers for EVERY session id, and the action path is
 * create-or-get, so a caller naming an unused id gets a new, empty session on
 * the channel instance rather than a refusal. Boundness — not existence — is
 * therefore the test: `openChannels` writes `members` and `instructions`
 * together, and nothing else does.
 *
 * Answered against the WHOLE declared schema rather than by checking that the
 * two keys are present. A presence check calls `{ members: [42], instructions:
 * "x" }` a channel: the post path would admit it, `openChannels` would skip it
 * as already open, and it would fail its declared schemas on every later
 * read — bound to nothing, and repairable by nothing. A state the schema
 * cannot parse is not a channel.
 *
 * Exported for the binder, which asks this same question of a 409 — is a
 * channel open here, or merely a session? One definition, because a binder
 * reading boundness differently from the fence would leave sessions the fence
 * still rejects. What the binder then DOES with the answer is its own and
 * narrower: it releases an id only when this kind's own empty session holds it.
 * Not re-exported from the package root.
 */
export function boundChannel(
  state: Readonly<Record<string, unknown>>
): ChannelSessionState | undefined {
  const parsed = channelSessionStateSchema.safeParse(state);
  return parsed.success ? parsed.data : undefined;
}

/** The append: the whole of what the post entry's queue hold covers. */
const appendPost = handler({
  name: "channel-append-post",
  inputSchema: channelPostInputSchema,
  outputSchema: channelTranscriptLineSchema,
  execute: async (input: ChannelPostInput, ctx): Promise<ChannelTranscriptLine> => {
    const channel = boundChannel(ctx.session.state);
    if (channel === undefined) {
      throw new ChannelPostRefusedError(
        "channel-not-bound",
        `session "${ctx.session.identity.id}" is not an open channel. A channel's session is ` +
          `opened by \`openChannels\`; naming an id nobody opened creates an empty session, not a channel.`
      );
    }

    // A validity check against the declared roster, NOT authentication. The
    // claim stays unverified either way; this only stops a line naming a seat
    // the channel has never heard of.
    if (input.author !== undefined && !channel.members.includes(input.author)) {
      throw new ChannelPostRefusedError(
        "author-not-a-member",
        `"${input.author}" is not a member of channel "${ctx.session.identity.id}". ` +
          `Members: ${channel.members.length > 0 ? channel.members.join(", ") : "(none)"}.`
      );
    }

    const line: ChannelTranscriptLine = {
      id: crypto.randomUUID(),
      at: Date.now(),
      // The server's value. BP-031: never the caller's, and the input schema is
      // closed so there is no caller value to take.
      principal: ctx.session.identity.userId ?? ctx.session.identity.id,
      ...(input.author === undefined ? {} : { author: input.author }),
      authorVerified: false as const,
      body: input.body
    };

    // Commutative, so two appends that raced never clobber one another and this
    // floor needs no compare-and-swap.
    await ctx.session.pushState("transcript", line);
    return line;
  }
});

/**
 * The clean projection. Deliberately not `ctx.session.items.client()`.
 *
 * A factory because the declared board names come from the roster the KIND was
 * built with, filtered to this session's own id — not from session state. That
 * is what makes an edited `CHANNEL.md` reach a channel that is already open:
 * the list is re-derived from the file on the next bind, and the transcript,
 * which is the only thing a channel cannot re-derive, is never written to.
 */
const readChannelFor = (boardIds: readonly string[]) =>
  handler({
    name: "channel-read",
    inputSchema: z.object({}).strict(),
    outputSchema: channelReadOutputSchema,
    execute: async (_input, ctx): Promise<ChannelReadOutput> => {
      const channel = boundChannel(ctx.session.state);
      if (channel === undefined) {
        throw new ChannelPostRefusedError(
          "channel-not-bound",
          `session "${ctx.session.identity.id}" is not an open channel.`
        );
      }
      const boards = channelBoardNamesFor(ctx.session.identity.id, boardIds);
      return {
        id: ctx.session.identity.id,
        ...(ctx.session.metadata.description === undefined
          ? {}
          : { description: ctx.session.metadata.description }),
        members: channel.members,
        // Omitted rather than `[]` when this channel holds none — see the
        // schema. The rows never come back here either way: reading a board is
        // a board read.
        ...(boards.length === 0 ? {} : { boards }),
        transcript: channel.transcript
      };
    }
  });

/** The ledger shape the two board actions use: the substrate's ref. */
type ChannelTaskLedger = Exclude<Awaited<ReturnType<typeof resolveChannelBoard>>, undefined>;

/** What filing one row takes. Closed, as the post input is. */
export const channelFileTaskInputSchema = z
  .object({
    /** The board's LOCAL name, as the `CHANNEL.md` declared it. */
    board: z.string().min(1),
    goal: z.string().min(1),
    title: z.string().min(1).optional(),
    context: z.string().optional(),
    /**
     * The board's routing key for this row. **Not a seat**: which seat it
     * reaches is the seat-side board's wiring.
     */
    assignee: z.string().min(1).optional(),
    priority: z.number().optional(),
    maxAttempts: z.number().int().min(1).optional(),
    labels: z.array(z.string()).optional(),
    input: z.unknown().optional(),
    /** Optional, unverified claim about which member is filing. */
    author: z.string().optional()
  })
  .strict();

export type ChannelFileTaskInput = z.infer<typeof channelFileTaskInputSchema>;

/** What filing one row hands back: where it landed, and which row it is. */
export const channelFileTaskOutputSchema = z.object({
  board: z.string(),
  /** The minted ledger id — the same string a seat declares. */
  boardId: z.string(),
  taskId: z.string(),
  status: z.string()
});

export type ChannelFileTaskOutput = z.infer<typeof channelFileTaskOutputSchema>;

/** What reading one board takes. */
export const channelReadBoardInputSchema = z.object({ board: z.string().min(1) }).strict();

/**
 * One row as this channel publishes it — an **allowlist**, not the task minus a
 * field.
 *
 * `readBoard` is a public action whose output reaches a model's context, so
 * **schema membership is itself a publication**. An omit-list would publish
 * every field a later revision adds to `Task` by default, and the field that
 * prompted this one (`claimedBy`, carrying a session, request and tenant id)
 * was itself added after the type existed. Naming what goes out inverts that:
 * a new field stays in until somebody decides otherwise.
 *
 * Left out, and why: `claimedBy`, `leaseUntil` and `leaseDurationMs` are
 * execution coordinates — where an attempt is running, not what the work is.
 * `retryLedger`, `abandonments` and `incarnationId` are the substrate's own
 * bookkeeping. `revision`, `writeLog` and `writeLogTruncated` are write
 * provenance, answered by the substrate's own API rather than by a board read.
 * `SERVER_ONLY_TASK_FIELDS` in `change-event.ts` is canonical for the first of
 * those; this covers the one boundary the substrate's emitter does not.
 */
export const channelBoardRowSchema = taskSchema.pick({
  id: true,
  goal: true,
  title: true,
  context: true,
  status: true,
  attempts: true,
  maxAttempts: true,
  assignee: true,
  deps: true,
  priority: true,
  input: true,
  output: true,
  error: true,
  feedback: true,
  labels: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true
});

/** What reading one board gives back: the rows, and nothing about the conversation. */
export const channelReadBoardOutputSchema = z.object({
  board: z.string(),
  boardId: z.string(),
  tasks: z.array(channelBoardRowSchema)
});

export type ChannelReadBoardOutput = z.infer<typeof channelReadBoardOutputSchema>;

/**
 * Resolve the ledger a caller named, against the channel's OWN declared list.
 *
 * Two fences in one place, in the order an author wants to hear them: the
 * session must be an open channel, and the name must be one this channel
 * declared. The id is then minted from `ctx.session.identity.id` — never from
 * the payload — so a caller naming a board another channel declared addresses
 * this channel's id and simply misses it (BP-031). There is no input through
 * which another channel's rows can be selected.
 *
 * The ledger is resolved ONCE per request and handed to the caller, rather than
 * re-walking the resource registry per operation for an answer that cannot
 * change inside a request.
 */
async function ledgerNamed(
  ctx: BlockContext,
  boardIds: readonly string[],
  name: string
): Promise<{ boardId: string; channel: ChannelSessionState; ledger: ChannelTaskLedger }> {
  const channel = boundChannel(ctx.session.state);
  if (channel === undefined) {
    throw new ChannelPostRefusedError(
      "channel-not-bound",
      `session "${ctx.session.identity.id}" is not an open channel. A channel's session is ` +
        `opened by \`openChannels\`; naming an id nobody opened creates an empty session, not a channel.`
    );
  }

  const channelId = ctx.session.identity.id;
  const held = channelBoardNamesFor(channelId, boardIds);
  if (!held.includes(name)) {
    throw new ChannelPostRefusedError(
      "board-not-declared",
      `channel "${channelId}" declares no board "${name}". ` +
        `Boards: ${held.length > 0 ? held.join(", ") : "(none)"}. A board is declared in the ` +
        `channel's own \`CHANNEL.md\`, and its ledger id is minted from this channel's id.`
    );
  }

  // Before resolving, because an org-less request has no org scope at all and
  // the registry would report the board as unregistered — true, but it names
  // the wrong cause. A board is org-scoped storage by construction.
  if (ctx.org === undefined) {
    throw new ChannelPostRefusedError(
      "board-needs-an-org",
      `channel "${channelId}" holds board "${name}", but this channel is open without an ` +
        `organization. A board is org-scoped storage, so there is nothing to read or write ` +
        `in. Open the channel with an \`orgId\` (or as a caller whose verified identity ` +
        `carries one) and the board resolves.`
    );
  }

  const boardId = channelBoardId(channelId, name);

  // Caught rather than tested for: the resource registry THROWS on a key it
  // does not hold, so an `undefined` check alone is a branch that never runs
  // and a message nobody ever reads. Both outcomes land here and produce the
  // same refusal.
  let ledger: ChannelTaskLedger | undefined;
  try {
    ledger = await resolveChannelBoard(ctx, boardId);
  } catch {
    ledger = undefined;
  }
  if (ledger === undefined) {
    throw new ChannelPostRefusedError(
      "board-not-declared",
      `channel "${channelId}" declares board "${name}", but its ledger is not registered on ` +
        `this flow. The channel kind is built holding every board its roster minted, so this ` +
        `means the kind was built from a different roster than the one that opened this channel.`
    );
  }
  return { boardId, channel, ledger };
}

/**
 * File one row onto a board this channel holds.
 *
 * The roster check on `author` is the **same check a post meets, in the same
 * words** — and it is a validity check against the declared roster, not
 * authentication. `author` is optional and unverified, so a caller that omits
 * it is not checked at all, on this path exactly as on the post path. Filing is
 * not members-only, and this action does not pretend it is: the per-caller
 * identity that would make it so does not exist on the channel session
 * contract.
 */
const fileTaskFor = (boardIds: readonly string[]) =>
  handler({
    name: "channel-file-task",
    inputSchema: channelFileTaskInputSchema,
    outputSchema: channelFileTaskOutputSchema,
    execute: async (input: ChannelFileTaskInput, ctx): Promise<ChannelFileTaskOutput> => {
      const { boardId, channel, ledger } = await ledgerNamed(ctx, boardIds, input.board);

      // A validity check against the declared roster, NOT authentication. The
      // claim stays unverified either way; this only stops a row naming a seat
      // the channel has never heard of.
      if (input.author !== undefined && !channel.members.includes(input.author)) {
        throw new ChannelPostRefusedError(
          "author-not-a-member",
          `"${input.author}" is not a member of channel "${ctx.session.identity.id}". ` +
            `Members: ${channel.members.length > 0 ? channel.members.join(", ") : "(none)"}.`
        );
      }

      // The row id is minted, never supplied — the same call `addTask` makes.
      // A caller-chosen id would let one caller collide with a row another
      // already filed, and the substrate reports that collision in the store's
      // own words, naming the ledger key. Neither door offers it.
      const task = await ledger.addTask({
        goal: input.goal,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.context === undefined ? {} : { context: input.context }),
        ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
        ...(input.labels === undefined ? {} : { labels: input.labels }),
        ...(input.input === undefined ? {} : { input: input.input }),
        // Carried with the same disclaimer a transcript line carries, rather
        // than dropped: a caller that supplied a label should find it again,
        // and a reader of the row must not mistake it for a proven one.
        ...(input.author === undefined
          ? {}
          : { metadata: { author: input.author, authorVerified: false } })
      });

      return { board: input.board, boardId, taskId: task.id, status: task.status };
    }
  });

/** Read one board this channel holds. */
const readBoardFor = (boardIds: readonly string[]) =>
  handler({
    name: "channel-read-board",
    inputSchema: channelReadBoardInputSchema,
    outputSchema: channelReadBoardOutputSchema,
    execute: async (
      input: z.infer<typeof channelReadBoardInputSchema>,
      ctx
    ): Promise<ChannelReadBoardOutput> => {
      const { boardId, ledger } = await ledgerNamed(ctx, boardIds, input.board);
      return {
        board: input.board,
        boardId,
        // The allowlist above is the redaction: `pick` drops `claimedBy` and
        // every other coordinate with it, and parsing also strips the handle's
        // `items()` method, so what comes back is the row rather than a live
        // handle.
        tasks: ledger.list().map((task) => channelBoardRowSchema.parse(task))
      };
    }
  });

/** What the fan-out entry is handed: enough to say which post is being delivered. */
const channelFanOutInputSchema = z.object({
  postId: z.string(),
  body: z.string(),
  principal: z.string(),
  author: z.string().optional()
});

export type ChannelFanOutInput = z.infer<typeof channelFanOutInputSchema>;

/** What a notify block is handed, once per declared member per post. */
export const channelNotifyInputSchema = z.object({
  /** The channel's session id. */
  channelId: z.string(),
  /** The declared member this delivery is addressed to. */
  member: z.string(),
  postId: z.string(),
  body: z.string(),
  principal: z.string(),
  author: z.string().optional()
});

export type ChannelNotifyInput = z.infer<typeof channelNotifyInputSchema>;

/** What a rescued delivery failure carries out: the reason, and nothing durable. */
const channelRefusalNoteSchema = z.object({
  delivered: z.literal(false),
  reason: z.string()
});

/**
 * Absorb one member's delivery refusal so the remaining members are still
 * attempted, carrying the reason out as this block's own output.
 *
 * **Nothing about a channel's session is written here, deliberately.** The
 * obvious home for a delivery outcome — `ctx.session.appendJournal` — writes
 * the WHOLE session record back with `"any"` and no compare-and-swap, and this
 * rescue runs in the separate `onPosted` request, holding the session snapshot
 * that request loaded. A post that landed in between is inside the state being
 * written back, so recording the failure would silently erase it — the one
 * thing a channel promises never happens. `setMetadata` has the same shape.
 *
 * The only concurrency-safe write a block has is a state verb (`pushState` and
 * friends, which the store applies as a delta), and a delivery outcome is not a
 * channel fact to widen every channel's declared state with. So the reason
 * travels in this request's own item log, alongside the rest of the fan-out's
 * trace, and nowhere else. An unrecorded delivery failure is a far smaller loss
 * than a vanished post.
 */
const noteDeliveryRefusal = handler({
  name: "channel-delivery-refused",
  inputSchema: z.unknown(),
  outputSchema: channelRefusalNoteSchema,
  execute: async (error: unknown) => ({
    delivered: false as const,
    reason: `channel delivery refused: ${error instanceof Error ? error.message : String(error)}`
  })
});

/**
 * Absorb a refused hand-off — the fan-out request could not be started at all.
 *
 * Reached on a host whose dispatcher hands work to an external queue, where a
 * delivery into an existing session refuses `external-dispatcher` by name. The
 * post is already appended and stays appended: a client post on such a host
 * still works, and only the waking does not.
 *
 * Writes nothing to the session for the reason {@link noteDeliveryRefusal}
 * gives. This one runs inside the post's own request, where the queue hold
 * makes a journal write look safe — but "safe because nothing else is writing
 * right now" is not a property this flow can keep true, so the rule here is the
 * flat one: a channel makes no session write that is not a state delta.
 */
const noteHandOffRefusal = handler({
  name: "channel-hand-off-refused",
  inputSchema: z.unknown(),
  outputSchema: channelRefusalNoteSchema,
  execute: async (error: unknown) => ({
    delivered: false as const,
    reason: `channel fan-out not started: ${error instanceof Error ? error.message : String(error)}`
  })
});

// ---------------------------------------------------------------------------
// The live inventory's writer half
// ---------------------------------------------------------------------------

/**
 * The action the boot binder dispatches into each open channel's OWN session,
 * so the channel writes its own row.
 *
 * **Pinned.** `openInventory` names this string, and a channel kind a caller
 * hand-rolled must declare an action under it — the same way it must declare
 * `cardinality: "singleton"`. A kind that does not is a per-channel failure the
 * binder names, never a channel silently missing from the inventory.
 */
export const INVENTORY_REGISTER_CHANNEL = "registerChannelInInventory";

/**
 * The action the boot binder dispatches ONCE, carrying the roster's seats.
 *
 * **Pinned**, for the same reason. One run for the whole roster rather than one
 * per seat: a seat holds no session, so there is no per-seat place this has to
 * land, and the rows are a straight copy of what the binder already holds.
 *
 * Lives in `internal.actions`, never the public map — its whole input is the
 * row data, with nothing to check it against. Reachable only by the binder's
 * own direct, trusted `runAction({
    orgId: DEFAULT_ORG_ID, source: "internal", ... })` call.
 */
export const INVENTORY_REGISTER_SEATS = "registerSeatsInInventory";

/** Nothing a caller supplies reaches the channel's row. */
const registerChannelInputSchema = z.object({}).strict();

/** What a registration reports back: the row it wrote, so a caller can read it without a second read. */
export const inventoryChannelRegisteredSchema = z.object({
  id: z.string(),
  kind: z.string(),
  members: z.array(z.string())
});

/** The roster's seats, as the binder holds them. */
const registerSeatsInputSchema = z
  .object({ seats: z.array(seatInventoryRowSchema) })
  .strict();

/** What the seat write reports: how many rows landed. */
export const inventorySeatsRegisteredSchema = z.object({ written: z.number() });

/**
 * The two blocks that write the live inventory, built for one channel kind.
 *
 * Built per kind rather than once, because a channel row records **which kind
 * minted it** and a block cannot read its own flow's kind: `ctx.flow` is
 * narrowed to the create-time config bag and carries no name. So the kind is
 * closed over here, at the one place that also writes `kind:` onto the flow.
 *
 * Both blocks refuse an org-less request by name. The inventory is org-scoped
 * storage, so without an org there is nothing to write in — and the resource
 * registry would report the collection as unregistered, which sends a reader to
 * check a registration that is fine.
 *
 * @param kind The kind name the flow declaring these actions was built with.
 *   `defineChannelFlow` passes its own; a hand-rolled kind passes the same
 *   string it passed `defineFlow({ kind })`, and a row carrying the wrong one
 *   is that kind's bug in the same way a mismatched `cardinality` is.
 * @returns Both entries, keyed by their action name. The blocks declare the
 *   collections they touch, so installing an entry installs its collection
 *   too. **Split them across `actions` and `internal.actions` — do not spread
 *   the whole return into `actions`.** `registerSeats`'s whole input is
 *   caller-supplied row data with nothing to check it against, so a public
 *   caller could write fabricated seat rows; `registerChannel` has no such
 *   risk (empty input, derives its row from the channel's own session state),
 *   so it is the one safe to leave public. `defineChannelFlow`'s own built-in
 *   kind makes exactly this split — read it there for the mechanics.
 *
 * @example
 *   const writer = inventoryWriterActions("briefing");
 *   defineFlow({
 *     kind: "briefing",
 *     cardinality: "singleton",
 *     session: { stateSchema: briefingState },
 *     actions: { ...myActions, registerChannelInInventory: writer.registerChannelInInventory },
 *     internal: {
 *       actions: { registerSeatsInInventory: writer.registerSeatsInInventory }
 *     }
 *   });
 */
export function inventoryWriterActions(kind: string) {
  // Fresh per call. Two collections declared from one factory share storage —
  // a collection is addressed by its pattern and scope, never by object
  // identity — so this costs nothing and keeps the declaration local to the
  // flow that installs it.
  const channels = defineChannelInventoryCollection();
  const memberships = defineMembershipIndexCollection();
  const seats = defineSeatInventoryCollection();

  const registerChannel = handler({
    name: "channel-register-in-inventory",
    inputSchema: registerChannelInputSchema,
    outputSchema: inventoryChannelRegisteredSchema,
    resources: { channels, memberships },
    execute: async (_input, ctx) => {
      const channel = boundChannel(ctx.session.state);
      if (channel === undefined) {
        throw new ChannelPostRefusedError(
          "channel-not-bound",
          `session "${ctx.session.identity.id}" is not an open channel, so there is no ` +
            `membership to publish. A channel's session is opened by \`openChannels\`, and the ` +
            `inventory binder runs after it.`
        );
      }
      if (ctx.org === undefined) {
        throw new Error(
          `channel "${ctx.session.identity.id}" cannot register in the inventory: it is open ` +
            `without an organization, and the inventory is org-scoped storage. Open the channel ` +
            `with an \`orgId\` and it registers.`
        );
      }

      const id = ctx.session.identity.id;
      // The channel's OWN session state, and nothing else. The binder carries
      // no members, deliberately: a roster's `members:` is what a file said
      // when it was last read, and an edit to it never reaches a session that
      // is already open. Copying it here would republish that file-time answer
      // under a live name.
      const members = [...channel.members];

      // Every member's key is built up front, before anything is written.
      // `membershipKey` throws on a member id that can never be one — and
      // that failure is permanent, not flaky, so it must not land after some
      // rows are already committed: a caller that retries a boot gets the
      // same throw on the same member every time, and a run that had already
      // written part of itself before hitting it would keep re-adding to a
      // half-written state instead of leaving nothing behind.
      const membershipKeys = members.map((seatId) => membershipKey(seatId, id));

      // The membership rows go FIRST, and the channel row that names them
      // goes last. Neither write is transactional with the other — a store
      // failure partway through the loop below still leaves whatever landed
      // before it — so the ordering is what stops the channel row from ever
      // claiming a member the index does not have: the row is only written
      // once every membership row it will name already exists. What it does
      // not buy: a membership row from an EARLIER successful run can still
      // outlive this run's channel row if this run's own loop fails partway
      // through. That row is stale, not contradictory, and nothing here
      // prunes stale rows in the first place (see `inventoryWriterActions`'s
      // header).
      for (let i = 0; i < members.length; i++) {
        await ctx.resources.memberships.upsert(membershipKeys[i], {
          seatId: members[i],
          channelId: id
        });
      }

      // `openedAt` is create-only, so a second boot does not restamp a channel
      // that has been open since the first one.
      await ctx.resources.channels.upsert(
        id,
        { id, kind, members },
        { openedAt: new Date().toISOString() }
      );

      return { id, kind, members };
    }
  });

  const registerSeats = handler({
    name: "inventory-register-seats",
    inputSchema: registerSeatsInputSchema,
    outputSchema: inventorySeatsRegisteredSchema,
    resources: { seats },
    execute: async (input, ctx) => {
      if (ctx.org === undefined) {
        throw new Error(
          "the seat rows cannot be written: this request carries no organization, and the " +
            "inventory is org-scoped storage. Run the seat write under the same `orgId` the " +
            "channels were opened with."
        );
      }

      const problems: string[] = [];
      let written = 0;
      for (const row of input.seats) {
        try {
          await ctx.resources.seats.upsert(row.id, row);
          written += 1;
        } catch (error) {
          problems.push(
            `seat "${row.id}" — ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Every row is attempted before anything is reported: one seat the store
      // refuses is not an org with no seat inventory. The throw is what carries
      // the failure back out — a boot door hands back an action's return value
      // in a shape this package cannot read, so a `problems` field on the
      // output would reach nobody.
      if (problems.length > 0) {
        throw new Error(
          `${problems.length} of ${input.seats.length} seat rows could not be written:\n  - ` +
            problems.join("\n  - ")
        );
      }
      return { written };
    }
  });

  return {
    [INVENTORY_REGISTER_CHANNEL]: {
      block: registerChannel,
      description:
        "Publish this channel's row and its membership rows into the org's live inventory, " +
        "from the channel's own session state. Boot machinery: takes no input, and re-running " +
        "it writes the same rows."
    },
    [INVENTORY_REGISTER_SEATS]: {
      block: registerSeats,
      description:
        "Write the org's seat rows into the live inventory. Boot machinery, called once by " +
        "`openInventory` with the roster it was hired from."
    }
  };
}

export interface DefineChannelFlowOptions {
  /**
   * The fan-out slot: a block run once per declared member per post, outside
   * the post's queue hold. Absent by default — a channel with no slot lands
   * posts and wakes nobody.
   *
   * The framework carries the policy and the app supplies the addresses.
   * Naming a recipient from stored data is refused by the dispatch substrate,
   * so a notify block declares its own targets; it never reads one out of the
   * members list and dispatches to it.
   *
   * Typed `BlockDefinition<any, any>` as every other factory in the repo types
   * a block slot (`goalSeekLoop`'s `seed`/`replanner`, `supervisor`'s
   * `worker`/`planner`): the two schema params stay open because a slot's block
   * brings its own. Core exports no block-slot type to use instead.
   */
  notify?: BlockDefinition<any, any>;

  /**
   * The MINTED ledger ids of every board this roster's channels declared —
   * `<channelId>.<boardName>`, never a local name.
   *
   * Supplied by `channelInstances` from the roster it is validating, not by an
   * app: a board is declared in a `CHANNEL.md`, and an id is minted from where
   * that file sits. Absent, this kind holds no board and carries neither board
   * action — which is exactly the shape it had before boards existed.
   *
   * One flat list for every channel on the instance, because a channel kind is
   * a singleton and its sessions are the channels: each session filters the
   * list down to its own by id, and a board id splits into its channel and its
   * name unambiguously (a board name carries no dot).
   */
  boards?: readonly string[];

  /**
   * Carry the live inventory's writer half — the two actions
   * {@link inventoryWriterActions} builds, and the collections they write.
   *
   * Absent by default, and absent means absent: no collection is declared, no
   * action exists, and a channel behaves exactly as it did before the inventory
   * existed. An entry that is only there to do nothing is worse than none,
   * which is how the fan-out slot beside it works too.
   *
   * Supplied by `channelInstances({ inventory: true })` for the built-in, so an
   * app turns the inventory on at one call rather than by rebuilding the kind.
   */
  inventory?: boolean;
}

/**
 * What {@link defineChannelFlow} returns: the flow factory, plus the one thing
 * `channelInstances` needs of it.
 *
 * `withBoards` is NOT on {@link ChannelKind}, and that is the point. A kind a
 * caller wrote is zero-arg and stays zero-arg; handing board ids through the
 * public kind contract would be a permanent widen bought for no consumer that
 * exists. Instead, a kind that CAN hold boards is one this function built, and
 * a record pairing `boards:` with any other kind is refused by name at bind.
 */
export type ChannelFlowFactory = ReturnType<typeof defineFlow> & {
  /** The same kind, rebuilt holding these minted board ids. */
  withBoards: (boards: readonly string[]) => ChannelFlowFactory;
};

/** Is this channel kind one {@link defineChannelFlow} built? */
export function holdsBoards(kind: unknown): kind is ChannelFlowFactory {
  return (
    typeof kind === "function" &&
    typeof (kind as Partial<ChannelFlowFactory>).withBoards === "function"
  );
}

/**
 * Build a channel kind.
 *
 * Every kind built here carries the same identity contract the registry
 * enforces: `cardinality: "singleton"`, so `flow.id === flow.kind`. A custom
 * kind passed through `channelInstances`'s `kinds` map must carry it too.
 *
 * @param options `notify`: the per-member fan-out block, absent by default.
 *   `boards`: the minted ledger ids this kind holds, supplied by the binder.
 * @returns The flow factory. Call it (no arguments) to mint the one instance.
 */
export function defineChannelFlow(options: DefineChannelFlowOptions = {}): ChannelFlowFactory {
  const notify = options.notify;
  const boardIds = [...(options.boards ?? [])].sort();

  // One declaration object per minted id, always from the memo. Two separate
  // `defineTaskCollection` calls sharing an id share ROWS and not POLICY — the
  // handed-off assignee freeze is a WeakSet on the declaration — so the seat's
  // board and the channel's own writes must pass one value.
  const boardResources = Object.fromEntries(
    boardIds.map((id) => [id, channelBoardLedger(id)])
  );

  // Built once per kind, not per request, and only when this kind holds a
  // board: with no board there is nothing to file onto and nothing to read, so
  // there is no action rather than an action that always refuses.
  const readChannel = readChannelFor(boardIds);
  const fileTask = boardIds.length === 0 ? undefined : fileTaskFor(boardIds);
  const readBoard = boardIds.length === 0 ? undefined : readBoardFor(boardIds);

  // Built on the FACTORY, never behind a `kind === "channel"` test inside the
  // block: what the inventory promises is that EVERY open channel has a row,
  // and a kind check in there would make that false for every kind but this
  // one. What decides whether the rows are written is whether the app asked.
  const inventoryActions =
    options.inventory === true ? inventoryWriterActions(CHANNEL_KIND) : undefined;

  // Declared ONLY when a slot was supplied. With no slot there is nothing to
  // deliver, so there is no entry to declare and no dispatch to make — rather
  // than a declared entry that exists to do nothing.
  const fanOut =
    notify === undefined
      ? undefined
      : sequencer({
          name: "channel-fan-out",
          inputSchema: channelFanOutInputSchema
        })
          // Iterated from the session's own declared roster, read here rather
          // than carried in the payload: the roster is the channel's, and a
          // caller-supplied copy would be caller-controllable input on a
          // delivery path (BP-031).
          .forEach(
            (post: ChannelFanOutInput, ctx): ChannelNotifyInput[] => {
              const channel = boundChannel(ctx.session.state);
              return (channel?.members ?? []).map((member) => ({
                channelId: ctx.session.identity.id,
                member,
                postId: post.postId,
                body: post.body,
                principal: post.principal,
                ...(post.author === undefined ? {} : { author: post.author })
              }));
            },
            // One member's failure is absorbed and the rest are still
            // attempted; membership is never changed by a delivery.
            notify.rescue([{ block: noteDeliveryRefusal }])
          );

  // Hands the append off to a SEPARATE request so the queue hold covers the
  // append only. Fan-out latency must not count against the next poster's
  // 30s queue-wait budget — past it the waiting post is dropped, never written.
  const handOff =
    fanOut === undefined
      ? undefined
      : dispatcher({
          name: "channel-hand-off",
          action: "onPosted",
          inputSchema: channelFanOutInputSchema,
          // The channel's own session. `{ id }`, never `{ key }`: a key-derived
          // child id is hashed with the parent session and lineage, so it
          // cannot name a shared channel.
          session: { id: (_input, ctx) => ctx.session.identity.id }
        }).rescue([{ block: noteHandOffRefusal }]);

  const post =
    handOff === undefined
      ? appendPost
      : sequencer({
          name: "channel-post",
          inputSchema: channelPostInputSchema,
          outputSchema: channelTranscriptLineSchema
        })
          .step(appendPost)
          // A tap: the post's own output stays the appended line, and the
          // hand-off's refusal is rescued rather than rolled back. The
          // transcript is the durable record; delivery is best-effort.
          .tap(
            (line: ChannelTranscriptLine): ChannelFanOutInput => ({
              postId: line.id,
              body: line.body,
              principal: line.principal,
              ...(line.author === undefined ? {} : { author: line.author })
            }),
            handOff
          );

  const flow = defineFlow({
    kind: CHANNEL_KIND,
    // Not a preference: it is the declared mechanism for "one kind means one
    // thing". The registry throws `singleton-id-mismatch` unless id === kind.
    cardinality: "singleton",
    session: { stateSchema: channelSessionStateSchema },
    // The ledgers, and nothing else: no board, no drain, no task entry. A
    // channel HOLDS rows; running them stays on the seat's side of the fence,
    // and `defineFlow` asks nothing of a flow that declares only a collection.
    resources: boardResources,
    actions: {
      post: {
        block: post,
        description:
          "Post a line to this channel. The channel is the session; `author` is an unverified claim.",
        // Keyed on the session by default, so two posts on ONE channel
        // serialise and posts on two channels never contend.
        concurrency: "queue"
      },
      read: {
        block: readChannel,
        // Names boards only on a kind that holds one: this string is what a
        // model is told the action does, and a boardless kind returns no
        // `boards` key at all.
        description:
          boardIds.length === 0
            ? "Read this channel's transcript, members and description."
            : "Read this channel's transcript, members, description and declared board names."
      },
      ...(fileTask === undefined || readBoard === undefined
        ? {}
        : {
            fileTask: {
              block: fileTask,
              description:
                "File a row onto one of this channel's boards. `author` is an unverified claim, " +
                "checked against the roster and never proof of who called."
            },
            readBoard: {
              block: readBoard,
              description: "Read the rows on one of this channel's boards."
            }
          }),
      // `registerChannel` only. It takes a closed, empty input and derives the
      // row entirely from `ctx.session.state` — the channel's own,
      // already-open state — so a caller cannot make it write anything but
      // that channel's true members, and calling it early or twice is
      // harmless. Public because the door that reaches it is the app's own
      // action client at boot, and an internal dispatch resolves from a
      // different map.
      //
      // `registerSeats` is deliberately NOT here — see `internal.actions`
      // below for why.
      ...(inventoryActions === undefined
        ? {}
        : { [INVENTORY_REGISTER_CHANNEL]: inventoryActions[INVENTORY_REGISTER_CHANNEL] })
    },
    internal: {
      actions: {
        // The same blocks a client reaches, so another flow's dispatch lands on
        // one implementation rather than a second spelling of it.
        //
        // Both registrations are required, and so is repeating `concurrency`:
        // `resolveEntry` reads one map per dispatch type and never falls
        // through to another, so a name in `actions` is unreachable by an
        // internal dispatch, and the arbiter reads `concurrency` off whichever
        // entry it resolved. Sharing the block ref is the whole dedupe there is.
        post: { block: post, concurrency: "queue" },
        read: { block: readChannel },
        ...(fileTask === undefined || readBoard === undefined
          ? {}
          : { fileTask: { block: fileTask }, readBoard: { block: readBoard } }),
        // `registerSeats` lives ONLY here, never in the public `actions` map
        // above. Unlike `registerChannel`, it has no session state to derive
        // from — a seat has no session — so its whole input IS the row data,
        // with nothing in this package to check it against. Public
        // reachability would let any principal that can reach this flow write
        // fabricated `{ id, kind }` pairs into the org's seat inventory.
        // `internal.actions` resolves from its own map (`resolveEntry`,
        // `@flow-state-dev/engine`) that a caller-addressed dispatch can never
        // reach — `dispatchTypeOf` maps every caller-facing transport source
        // to `public`, never to `internal` — so the only way in is a direct,
        // trusted `runAction({ source: "internal", ... })` call, which is
        // exactly what `openInventory`'s `run` door makes for this one
        // request (see `open-inventory.ts`). A hand-rolled kind that spreads
        // `inventoryWriterActions(kind)` must do the same split itself — see
        // that function's own doc comment.
        ...(inventoryActions === undefined
          ? {}
          : { [INVENTORY_REGISTER_SEATS]: inventoryActions[INVENTORY_REGISTER_SEATS] }),
        ...(fanOut === undefined
          ? {}
          : {
              // `allow`, deliberately: this is the work that must NOT sit
              // behind the post queue.
              onPosted: { block: fanOut, concurrency: "allow" as const }
            })
      }
    }
  });

  // The rebuild seam. `options` is closed over, so a kind configured with a
  // notify slot keeps it when the binder hands it the roster's board ids —
  // which is what stops "give this channel a board" and "wake its members"
  // from being two mutually exclusive ways to configure one kind.
  return Object.assign(flow, {
    withBoards: (boards: readonly string[]) => defineChannelFlow({ ...options, boards })
  }) as ChannelFlowFactory;
}

/**
 * The built-in kind, seeded by `channelInstances` when the app names none.
 *
 * An app registers nothing to use channels. A custom kind is the rare escape
 * hatch, passed through the `kinds` map at boot.
 */
export const channelFlow = defineChannelFlow();
