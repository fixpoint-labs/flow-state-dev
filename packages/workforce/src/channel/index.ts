/**
 * The channel floor: the built-in kind, and the two-phase binder that turns
 * channel records into one registered instance per kind and one named session
 * per channel.
 *
 * Node-free, like the rest of this package's root — reading a `CHANNEL.md` off
 * disk is the `./loader` subpath's job.
 */

export {
  CHANNEL_KIND,
  ChannelPostRefusedError,
  channelFlow,
  channelNotifyInputSchema,
  channelPostInputSchema,
  channelReadOutputSchema,
  channelSessionStateSchema,
  channelTranscriptLineSchema,
  createChannelFlow,
  type ChannelNotifyInput,
  type ChannelPostInput,
  type ChannelReadOutput,
  type ChannelRefusalReason,
  type ChannelSessionState,
  type ChannelTranscriptLine,
  type CreateChannelFlowOptions
} from "./channel-flow";

export {
  channelInstances,
  openChannels,
  type ChannelInstancesOptions,
  type ChannelKind,
  type OpenChannelsOptions
} from "./channel-binder";

export {
  REFUSED_SYSTEM_KEY,
  REFUSED_SYSTEM_KEY_MESSAGE,
  type ChannelManifest
} from "../manifest";
