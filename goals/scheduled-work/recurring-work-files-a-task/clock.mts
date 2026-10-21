/**
 * Pin this process's clock to `GOAL_NOW`, then let it run on from there. Import
 * it first: a module that reads the time as it loads reads the pinned one.
 *
 * The host a goal process stands in for runs at a scheduled time; pinning the
 * clock is how one run of the goal stands at a Monday morning, a minute early,
 * or twenty seconds late, without waiting for one.
 */
const pinned = process.env.GOAL_NOW;
if (pinned !== undefined && pinned !== "") {
  const RealDate = Date;
  const offset = RealDate.parse(pinned) - RealDate.now();
  if (Number.isNaN(offset)) throw new Error(`GOAL_NOW ${JSON.stringify(pinned)} is not a time`);
  class PinnedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [string | number]));
    }
    static override now(): number {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = PinnedDate as DateConstructor;
}

export {};
