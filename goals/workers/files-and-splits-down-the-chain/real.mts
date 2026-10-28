/**
 * Leg e on the goal-local Lab: Alice asks `real.lead`, an `agent` worker on a
 * real model whose delegates take tasks, for a two-part job, in words picked
 * at run time from `fixtures/asks.json`. It only acts and waits; `run.mts`
 * grades from the store.
 */
import { randomInt } from "node:crypto";
import { PEOPLE } from "./lab/people.mts";
import { GRACE_MS, connect, quiet, word, type Acted, type Shipped } from "./scripted.mts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What leg e did, for `run.mts` to grade from the store. */
export interface LegE {
  conv: string;
  word: string;
  ask: string;
  turn: Acted;
  quietAt: number;
  graceMs: number;
}

/** Leg e: Alice asks `real.lead` for a two-part job in a new conversation, and waits for everything it starts to end. */
export async function legE(o: { origin: string; store: string; shipped: Shipped; asks: readonly string[]; say: (s: string) => void }): Promise<LegE> {
  const alice = connect(o.shipped, o.origin, o.store, PEOPLE.alice);
  const conv = await alice.conversation("agent", "real.lead");
  const w = word();
  const ask = o.asks[randomInt(o.asks.length)]!.replaceAll("{word}", w);
  o.say(`leg e: "${ask}"`);
  const turn = await alice.act("agent", conv, "respond", { message: ask }, 240_000);
  // The pieces it filed, their notices, and the turns those wake: all of it quiet, then a grace.
  await sleep(2_000);
  await quiet(o.store, 360_000);
  await sleep(GRACE_MS);
  const quietAt = await quiet(o.store, 240_000);
  return { conv, word: w, ask, turn, quietAt, graceMs: GRACE_MS };
}
