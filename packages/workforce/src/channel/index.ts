/**
 * The channel floor: the built-in kind, the two-phase binder that turns channel
 * records into one registered instance per kind and one named session per
 * channel, and the boards a channel holds.
 *
 * A board is a task ledger a `CHANNEL.md` declares by local name and the
 * framework mints an id for. The channel HOLDS it — files rows onto it and
 * reads it — and never runs it; draining stays on the seat's side, which is
 * what `channelBoard` and `channelBoardTaskTools` are for.
 *
 * Node-free, like the rest of this package's root — reading a `CHANNEL.md` off
 * disk is the `./loader` subpath's job.
 */

export {
  CHANNEL_KIND,
  ChannelPostRefusedError,
  INVENTORY_REGISTER_CHANNEL,
  INVENTORY_REGISTER_SEATS,
  inventoryChannelRegisteredSchema,
  inventorySeatsRegisteredSchema,
  inventoryWriterActions,
  channelFileTaskInputSchema,
  channelFileTaskOutputSchema,
  channelFlow,
  channelNotifyInputSchema,
  channelPostInputSchema,
  channelBoardRowSchema,
  channelReadBoardInputSchema,
  channelReadBoardOutputSchema,
  channelReadOutputSchema,
  channelSessionStateSchema,
  channelTranscriptLineSchema,
  defineChannelFlow,
  type ChannelFileTaskInput,
  type ChannelFileTaskOutput,
  type ChannelFlowFactory,
  type ChannelNotifyInput,
  type ChannelPostInput,
  type ChannelReadBoardOutput,
  type ChannelReadOutput,
  type ChannelRefusalReason,
  type ChannelSessionState,
  type ChannelTranscriptLine,
  type DefineChannelFlowOptions
} from "./channel-flow";

export {
  channelBoardIds,
  channelInstances,
  openChannels,
  type ChannelInstancesOptions,
  type ChannelKind,
  type OpenChannelsOptions
} from "./channel-binder";

export {
  channelBoard,
  channelBoardTaskTools,
  type ChannelBoardCollection
} from "./channel-board";

export {
  REFUSED_SYSTEM_KEY,
  REFUSED_SYSTEM_KEY_MESSAGE,
  type ChannelManifest
} from "../manifest";
