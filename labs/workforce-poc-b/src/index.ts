// @flow-state-dev/workforce-poc-b — throwaway L2-on-L1 reply-storm lab.

export { decideReply, parseAddress } from "./policy";
export type { Address, PolicyDecision } from "./policy";
export { boardPosts, replyBoard, BOARD_NAME, postPayloadSchema } from "./board";
export type { PostPayload } from "./board";
export {
  workforcePocBFlow,
  WORKFORCE_POC_B_KIND,
  seedInputSchema,
  receiveInputSchema,
  receiveOutputSchema,
  postInputSchema,
  inspectInputSchema,
} from "./flow";
export type { ReceiveOutput, PolicyMode } from "./flow";
