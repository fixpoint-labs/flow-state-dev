/**
 * A clock this run moves: `Date.now()` and `new Date()` read `at()`, which
 * `moveTo` sets; real time still runs between moves, so the engine's own
 * waits keep working. Import it first, so every module reads the moved clock.
 */
const RealDate = Date;
let offset = 0;

class MovedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + offset);
    else super(...(args as [string | number]));
  }
  static override now(): number {
    return RealDate.now() + offset;
  }
}
globalThis.Date = MovedDate as DateConstructor;

/** The time the run stands at. */
export const at = (): number => RealDate.now() + offset;

/** Stand at `time` (ms): later reads run on from it. */
export function moveTo(time: number): void {
  offset = time - RealDate.now();
}
