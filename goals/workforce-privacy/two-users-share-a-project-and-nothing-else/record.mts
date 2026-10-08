/**
 * What one run of steps keeps for the report: each step's verdict, the
 * surface it used (D2), what it showed, every model turn, and each boot.
 *
 * A step is PASS until something fails it. NOT RUN means the commit lacks
 * what the step needs (a worker an earlier step was to make, an action the
 * app doesn't have): the run couldn't grade it, and it counts against the
 * run like a FAIL. BLOCKED is QR-6's: no model key, no browser.
 */
import { join } from "node:path";
import type { Page } from "playwright";

export type Verdict = "PASS" | "FAIL" | "NOT RUN" | "BLOCKED";

/** Where a step's change or read went through (D2). */
export type Surface = "screen" | "turn" | "action" | "HTTP";

/** One model turn, quoted in the report by its ids. */
export interface Turn {
  step: string;
  who: string;
  words: string;
  sessionId: string;
  requestId: string | null;
  status: string;
  tools: Array<{ itemId: string; name: string; args: string; output: string }>;
  reply: string;
  replyItemId: string | null;
  /** The request's items, by type and id, when it stored no assistant message. */
  items?: string[];
  /** Set when a provider error re-ran the turn once (QR-10). */
  providerRetry?: string;
}

export interface StepEntry {
  verdict: Verdict;
  surfaces: Set<Surface>;
  notes: string[];
}

export class RunRecord {
  readonly steps = new Map<string, StepEntry>();
  readonly turns: Turn[] = [];
  readonly boots: Array<{ label: string; config: string; ms: number }> = [];
  readonly screenshots: string[] = [];
  constructor(readonly label: string, readonly shots: string) {}

  private entry(step: string): StepEntry {
    let e = this.steps.get(step);
    if (e === undefined) this.steps.set(step, (e = { verdict: "PASS", surfaces: new Set(), notes: [] }));
    return e;
  }
  /** Mark the surface a step used. */
  via(step: string, surface: Surface): void {
    this.entry(step).surfaces.add(surface);
  }
  /** What `step` showed when it held. */
  saw(step: string, what: string): void {
    this.entry(step).notes.push(what);
  }
  /** A failure of `step`; it stays FAIL whatever passes after. */
  fail(step: string, why: string): void {
    const e = this.entry(step);
    if (e.verdict === "PASS") e.verdict = "FAIL";
    e.notes.push(`FAIL: ${why}`);
  }
  /** The commit lacks what `step` needs. */
  notRun(step: string, why: string): void {
    const e = this.entry(step);
    if (e.verdict === "PASS") e.verdict = "NOT RUN";
    e.notes.push(`NOT RUN: ${why}`);
  }
  block(step: string, why: string): void {
    const e = this.entry(step);
    e.verdict = "BLOCKED";
    e.notes.push(`BLOCKED: ${why}`);
  }
  verdict(step: string): Verdict | undefined {
    return this.steps.get(step)?.verdict;
  }
  /** Steps that are not PASS, with their failing notes. */
  reds(): Array<{ id: string; verdict: Verdict; notes: string[] }> {
    return [...this.steps.entries()]
      .filter(([, e]) => e.verdict !== "PASS")
      .map(([id, e]) => ({ id, verdict: e.verdict, notes: e.notes.filter((n) => /^(FAIL|NOT RUN|BLOCKED)/.test(n)) }));
  }
  async shot(page: Page, name: string): Promise<void> {
    const path = join(this.shots, `${this.label}-${name}.png`);
    await page.screenshot({ path, fullPage: false }).catch(() => undefined);
    this.screenshots.push(path);
  }
}

/** A step's error message, short. */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 600);
