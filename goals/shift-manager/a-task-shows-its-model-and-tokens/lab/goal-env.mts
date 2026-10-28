/**
 * How this start of the Lab stands, set before anything else loads: import it
 * first.
 *
 * - `TASK_SPEND_GOAL_NOW` pins the clock to that time and lets it run on
 *   from there. Unused by this goal's legs; kept so the Lab stands as FIX-2145's.
 * - `TASK_SPEND_GOAL_PRODUCTION=1` runs the Lab as production: `NODE_ENV`
 *   is `production` and `FSDEV_TRACE_OBSERVABILITY` is unset, so traces are
 *   lean, as a deployed app's are. Leg e runs there. The goal's runner sets
 *   `NODE_ENV` on every child it starts, so it is set here instead.
 */
const pinned = process.env.TASK_SPEND_GOAL_NOW;
if (pinned !== undefined && pinned !== "") {
  const RealDate = Date;
  const offset = RealDate.parse(pinned) - RealDate.now();
  if (Number.isNaN(offset)) throw new Error(`TASK_SPEND_GOAL_NOW ${JSON.stringify(pinned)} is not a time`);
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

if (process.env.TASK_SPEND_GOAL_PRODUCTION === "1") {
  process.env.NODE_ENV = "production";
  delete process.env.FSDEV_TRACE_OBSERVABILITY;
}

export {};
