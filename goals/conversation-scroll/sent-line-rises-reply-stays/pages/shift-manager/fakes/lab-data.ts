/** The Lab, scripted: no client calls, no snapshot. See `../shared.ts`. A view the screen reads (a conversation's turns) never answers. */
export * from "../../../lib/lab-data";
const lab = {
  client: { userId: "alice", subscribe: () => ({ close: () => undefined }), view: () => new Promise(() => undefined) },
  refresh: async () => undefined,
  snapshot: undefined,
};
export const useLab = () => lab as never;
