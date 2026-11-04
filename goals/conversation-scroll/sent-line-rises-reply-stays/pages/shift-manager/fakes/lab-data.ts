/** The Lab, scripted: no client calls, no snapshot. See `../shared.ts`. */
export * from "../../../lib/lab-data";
const lab = { client: { userId: "alice" }, refresh: async () => undefined, answered: undefined, snapshot: undefined };
export const useLab = () => lab as never;
