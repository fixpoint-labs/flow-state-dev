/** The Lab, scripted: no client calls. See `../shared.ts`. A view the screen reads (a conversation's turns) never answers. */
export * from "../../../lib/lab-data";
const lab = {
  client: { userId: "alice", subscribe: () => ({ close: () => undefined }), view: () => new Promise(() => undefined) },
};
export const useLab = () => lab as never;
