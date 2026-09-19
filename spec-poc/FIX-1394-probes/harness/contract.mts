/**
 * The probe set, fixed before any variant was built (D2), and the one
 * capability every candidate has to carry.
 *
 * Nothing here knows about a candidate. That is the point: the probes are data,
 * the candidates are functions, and a candidate cannot reshape what passing
 * means. A probe added after the first variant exists is applied to every
 * variant or to none (BR-9).
 *
 * The capability below is also fixed. Four candidates carrying four different
 * example capabilities would produce four columns that cannot be read against
 * each other, so every candidate ships THIS one: one instruction paragraph, one
 * tool, one document. It is deliberately the smallest capability that touches
 * all three content kinds the collapse is about.
 */
import type { BlockDefinition } from "@flow-state-dev/core/types";

/** The six probes. Order is the reading order of the matrix. */
export const PROBES = ["P1", "P2", "P3", "P4", "P5", "P6"] as const;
export type ProbeId = (typeof PROBES)[number];

/** What each probe asks, in the words BUSINESS-RULES.md states them. */
export const PROBE_QUESTIONS: Record<ProbeId, string> = {
  P1: "a package carries instructions, and they reach the seat's prompt (BR-10)",
  P2: "a package carries a tool, callable only when the seat's `tools:` names it (BR-11)",
  P3: "a package carries a document: readable when attached, and on activation when held (BR-12)",
  P4: "the same authored bytes attach to a seat and sit in a library (BR-13)",
  P5: "the grant gate still holds with the package attached (BR-14)",
  P6: "an existing tree with no package authored is unchanged (BR-15)",
};

/**
 * A cell. `n/a` is a recorded result, not a blank: it means the probe
 * presupposes a package and this candidate authors none (S5).
 */
export type Verdict = "pass" | "fail" | "n/a";

export interface Cell {
  probe: ProbeId;
  verdict: Verdict;
  /** What was observed, in one line. Never a restatement of the verdict. */
  evidence: string;
}

/** Which of the two attachment modes a build is for. */
export type Mode = "attached" | "library";

/**
 * The one capability, fixed for every candidate.
 *
 * The strings are deliberately distinctive so an assertion that they reached
 * the model cannot pass by accident on some other text in the prompt.
 */
export const CAPABILITY = {
  /** P1's payload. */
  instructions:
    "HANDOVER PROTOCOL: log every handover in the ledger before you reply to the customer.",
  /** P2's payload — the name the seat's `tools:` must name for it to be callable. */
  toolName: "ledger-append",
  /** P3's payload. */
  documentName: "handover-ledger-format",
  // No angle brackets, deliberately: a skill body is HTML-escaped on its way
  // into the `<skills>` block, so a marker containing `<` would make every
  // opt-in cell fail on the harness's own string comparison rather than on the
  // candidate's delivery.
  documentBody:
    "LEDGER FORMAT: one line per handover, giving date, from, to and reason.",
} as const;

/**
 * How a candidate delivered the document, recorded so P3's cell says which
 * mechanism was used rather than only whether it worked.
 *
 * `perSeat` is the field that decides whether the delivery is honest: a
 * flow-level resource installs on the KIND, so it reaches every seat of that
 * kind whether or not they hold the package.
 */
export type DocumentDelivery =
  | { kind: "none"; why: string }
  | { kind: "flow-resource"; ref: string; perSeat: boolean }
  /** Prompt text carried per seat — a capability preset's `context` entry. */
  | { kind: "seat-context"; via: string }
  | { kind: "skill-body"; skill: string }
  | { kind: "skill-file"; skill: string; path: string };

/** What a candidate hands the harness after authoring one tree in one mode. */
export interface Build {
  /** Absolute root of the authored workforce tree. */
  root: string;
  /**
   * The bytes the AUTHOR wrote for the package, published path -> content.
   * P4 compares this map across the two modes; a candidate needing two
   * authored forms fails P4 here rather than by argument.
   */
  packageFiles: Record<string, string>;
  /** Per-seat block registry, exactly as `fsdev gen`'s `seatBlocks` export. */
  seatBlocks: Record<string, Record<string, BlockDefinition>>;
  /**
   * The flow kinds this build hires into.
   *
   * A candidate that compiles its package into a capability has to install it
   * on the kind, because installing a capability is the app's call and not a
   * worker file's (`seat-capabilities.ts`). So the candidate supplies the kind
   * and the probes never build one — which also keeps the probes from quietly
   * granting a candidate something it did not ask for.
   */
  kinds?: Record<string, unknown>;
  /** The seat that holds the package and names its tool. */
  holder: string;
  /**
   * A seat that holds the package exactly as the holder does and names NO tool
   * — P5's subject.
   *
   * It differs from `holder` in one line. A candidate that cannot produce this
   * seat cannot be checked against the grant gate in the package-attached case,
   * which is the only case the gate is at risk in: round 1 read the bystander
   * here, and an unattached seat has no tools whatever a reader does.
   */
  fenced: string;
  /** A sibling seat of the same kind holding nothing — P1's and P3's leak control. */
  bystander: string;
  /** How (and whether) the document reaches a seat. */
  document: DocumentDelivery;
  /**
   * The message that activates a held package, for the library mode's opt-in
   * half. `null` when the candidate has no activation step.
   */
  activationMessage: string | null;
  /** Per-probe note the cell's evidence line quotes. */
  mechanism: Partial<Record<ProbeId, string>>;
}

/** A candidate format. Four of these are the matrix's columns. */
export interface Candidate {
  id: string;
  title: string;
  /** One line: what the author actually writes. Printed above the column. */
  authoring: string;
  /** `false` for the don't-collapse control, which authors no package. */
  authorsPackage: boolean;
  /**
   * Author the tree for one mode. Returns `null` when this candidate authors
   * no package at all, which is a result and not a failure (BR-16).
   */
  build(root: string, mode: Mode): Promise<Build | null>;
}
