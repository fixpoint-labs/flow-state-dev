/**
 * Variant D — don't collapse.
 *
 * Builds no package tree, by design (S5). Its column is filled by
 * characterizing what an author does TODAY: P5 and P6 are today's state and
 * are measured, not assumed; P1 to P4 are `n/a`, because each presupposes a
 * package and D is the candidate that says there should not be one.
 *
 * `n/a` here is a recorded result, not a blank (BR-16). The cost D carries is
 * the hand-work it leaves in place, and the ratify prices that against what
 * the other three cost to build.
 */
import type { Candidate } from "../harness/contract.mts";

export const variantD: Candidate = {
  id: "D",
  title: "don't collapse",
  authoring: "nothing new: a seat's file, its `blocks/` folder, its `skills/` folders",
  authorsPackage: false,
  async build(): Promise<null> {
    return null;
  },
};
