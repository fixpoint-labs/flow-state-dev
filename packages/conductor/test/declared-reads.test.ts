/**
 * The declaration contract: nothing may read a fact its phase did not declare.
 *
 * `reads` is the whole reason `decide` can be pure — the tick materializes the
 * declared set and hands over plain data. So an omission is not cosmetic. A
 * fetch driven strictly by declarations gives an undeclared fact its zero value
 * (`baseRed: false`, `reviewRounds: 0`) and the branch that depends on it dies
 * silently, with every existing test still green: they hand `decide` a literal
 * world and never go through the fetch path at all.
 *
 * These tests close that gap by **observing the reads** rather than restating
 * the table. The snapshot is wrapped in proxies that record which field each
 * predicate and each `decide` branch actually touches; the recorded facts are
 * then held against what the gate — or the phase — declared. A new branch that
 * consults an undeclared fact fails here the moment it is written, whatever the
 * table says.
 *
 * The relation asserted is a **subset**, deliberately: `reads` is an upper
 * bound on what the handling may touch. Over-declaring is legitimate —
 * `pr.mergeable` is declared by `awaiting_merge` and read by no predicate,
 * because `driver/reconcile` is what consumes it to synthesize
 * `merge_conflict`. Under-declaring is the bug.
 *
 * The sweep would pass vacuously if its worlds stopped reaching the interesting
 * branches, so `OBSERVED_AT_LEAST` pins the facts each phase must be seen
 * reading. Drop the red-CI world and that assertion fails rather than the suite
 * quietly proving nothing.
 */

import { describe, expect, it } from "vitest";
import { decide } from "../src/driver/decide";
import type { ConductorEntity } from "../src/driver/derive-gate";
import {
  EPIC_PHASES,
  ISSUE_PHASES,
  factsReadBy,
  type EntityKind,
  type PhaseDefinition,
  type WorldFact,
} from "../src/model/phases";
import type {
  ArtifactFacts,
  ChildIssueFacts,
  PullRequestFacts,
  World,
} from "../src/model/world";
import {
  SIGNAL_KINDS,
  artifact,
  epic,
  freshApproval,
  issue,
  pr,
  review,
  signal,
  world,
  worldWith,
} from "./fixtures";

/**
 * Which `WorldFact` each leaf of the snapshot belongs to. `null` marks
 * scaffolding that is always present and is nobody's declared dependency: an
 * artifact's identity, and the PR number an artifact is looked up by.
 *
 * `state` and `headSha` map to `pr.state` because they arrive together in the
 * one `GET /pulls/{n}` the reader always makes — a predicate that consults the
 * head SHA is consulting the PR's own record.
 */
const PR_FIELD_FACT: Record<keyof PullRequestFacts, WorldFact | null> = {
  number: null,
  state: "pr.state",
  headSha: "pr.state",
  mergeable: "pr.mergeable",
  checks: "pr.checkRuns",
  baseRed: "pr.baseStatus",
  reviews: "artifact.reviews",
};

const ARTIFACT_FIELD_FACT: Record<keyof ArtifactFacts, WorldFact | null> = {
  id: null,
  kind: null,
  hostedAt: null,
  reviewRounds: "artifact.rounds",
};

const WORLD_FIELD_FACT: Partial<Record<keyof World, WorldFact>> = {
  goalCheck: "goalCheck",
  childIssues: "childIssues",
  guidanceHashes: "guidance",
};

type FieldFacts = Readonly<Record<string, WorldFact | null | undefined>>;

/**
 * Record every tracked field read on `target`, then answer it normally.
 *
 * **A structural copy is not a consultation.** `decide` rebuilds the snapshot
 * to ask "would this gate still hold without the approval?", and a spread or an
 * `Object.values` touches every field on the way past. Counting those would
 * report the whole vocabulary as read and make the assertion meaningless. A
 * copy is distinguishable: it asks for the property *descriptor* immediately
 * before the value, where an ordinary read only takes the value.
 */
function watch<T extends object>(target: T, fields: FieldFacts, seen: Set<WorldFact>): T {
  const copying = new Set<string>();
  return new Proxy(target, {
    getOwnPropertyDescriptor(source, key) {
      if (typeof key === "string") copying.add(key);
      return Reflect.getOwnPropertyDescriptor(source, key);
    },
    get(source, key, receiver) {
      if (typeof key === "string") {
        if (copying.has(key)) {
          copying.delete(key);
        } else {
          const fact = fields[key];
          if (fact) seen.add(fact);
        }
      }
      return Reflect.get(source, key, receiver);
    },
  });
}

/**
 * The same world, instrumented. Every read of a fact-bearing field lands in
 * `seen`; values and identity are otherwise untouched, so predicates behave
 * exactly as they do against the plain snapshot.
 */
function observed(base: World, seen: Set<WorldFact>): World {
  const artifacts = base.artifacts.map((a) => watch(a, ARTIFACT_FIELD_FACT, seen));
  const pullRequests = Object.fromEntries(
    Object.entries(base.pullRequests).map(([number, facts]) => [
      number,
      watch(facts, PR_FIELD_FACT, seen),
    ]),
  );
  return watch({ ...base, artifacts, pullRequests }, WORLD_FIELD_FACT, seen);
}

const settledChild: ChildIssueFacts = { id: "FIX-2", settled: true };
const openChild: ChildIssueFacts = { id: "FIX-3", settled: false };

/**
 * Worlds chosen to reach every branch that consults the snapshot — each gate
 * applying and released, CI red on a clean base and on a broken one, feedback
 * with budget left and budget spent, and the epic's two halves.
 */
const WORLDS: readonly (readonly [string, World])[] = [
  ["nothing started", world()],
  ["spec PR open, unreviewed", worldWith("spec", pr())],
  ["spec PR reviewed", worldWith("spec", pr({ reviews: [review()] }))],
  [
    "spec PR reviewed, budget spent",
    worldWith("spec", pr({ reviews: [review()] }), { reviewRounds: 9 }),
  ],
  ["spec PR approved", worldWith("spec", pr({ reviews: [freshApproval()] }))],
  ["spec PR merged", worldWith("spec", pr({ state: "merged" }))],
  ["impl PR, CI red", worldWith("implementation", pr({ checks: "failure" }))],
  [
    "impl PR, CI red on a red base",
    worldWith("implementation", pr({ checks: "failure", baseRed: true })),
  ],
  ["impl PR, CI green", worldWith("implementation", pr({ checks: "success" }))],
  [
    "impl PR, changes requested",
    worldWith(
      "implementation",
      pr({ checks: "success", reviews: [review({ state: "CHANGES_REQUESTED" })] }),
    ),
  ],
  [
    "impl PR, conflicting",
    worldWith("implementation", pr({ checks: "success", mergeable: false })),
  ],
  [
    "impl PR approved",
    worldWith("implementation", pr({ checks: "success", reviews: [freshApproval()] })),
  ],
  [
    "impl PR merged, goal check pending",
    worldWith("implementation", pr({ state: "merged", checks: "success" })),
  ],
  [
    "impl PR merged, goal check failed",
    worldWith("implementation", pr({ state: "merged", checks: "success" }), {}, {
      goalCheck: "failed",
    }),
  ],
  [
    "impl PR merged, goal check passed",
    worldWith("implementation", pr({ state: "merged", checks: "success" }), {}, {
      goalCheck: "passed",
    }),
  ],
  ["epic spec PR reviewed", worldWith("epic_spec", pr({ reviews: [review()] }))],
  ["epic spec PR approved", worldWith("epic_spec", pr({ reviews: [freshApproval()] }))],
  ["epic with children outstanding", world({ childIssues: [settledChild, openChild] })],
  ["epic with every child settled", world({ childIssues: [settledChild] })],
  ["epic retrospective drafted", world({ artifacts: [artifact("retrospective")] })],
];

const PHASES: readonly (readonly [EntityKind, PhaseDefinition])[] = [
  ...ISSUE_PHASES.map((p) => ["issue", p] as const),
  ...EPIC_PHASES.map((p) => ["epic", p] as const),
];

const entityIn = (kind: EntityKind, definition: PhaseDefinition): ConductorEntity =>
  kind === "issue" ? issue(definition.name) : epic(definition.name);

describe("a gate reads only what it declares", () => {
  it("holds for every gate predicate against every world", () => {
    const undeclared: string[] = [];

    for (const [, definition] of PHASES) {
      for (const gate of definition.gates) {
        for (const [label, base] of WORLDS) {
          const seen = new Set<WorldFact>();
          const probe = observed(base, seen);
          gate.appliesWhen(probe);
          gate.satisfiedBy(probe);
          for (const fact of seen) {
            if (!gate.reads.includes(fact)) {
              undeclared.push(`${definition.name}/${gate.name} reads ${fact} (${label})`);
            }
          }
        }
      }
    }

    expect(undeclared).toEqual([]);
  });
});

describe("decide reads only what the phase declares", () => {
  /**
   * Facts each phase must be *seen* reading. Without this the sweep could stop
   * exercising a branch and still pass — a green result proving nothing.
   */
  const OBSERVED_AT_LEAST: Partial<Record<string, readonly WorldFact[]>> = {
    "issue/SPEC": ["pr.state", "artifact.reviews", "artifact.rounds"],
    "issue/IMPLEMENTATION": [
      "pr.state",
      "artifact.reviews",
      "pr.checkRuns",
      // The red-base guard and the round budget: the two reads that had no
      // declaration, and the reason this file exists.
      "pr.baseStatus",
      "artifact.rounds",
      "goalCheck",
    ],
    "epic/FRAMING": ["pr.state", "artifact.reviews", "artifact.rounds"],
    "epic/ISSUES": ["childIssues"],
  };

  /** Every fact `decide` touches in this phase, across all worlds and signals. */
  function sweep(kind: EntityKind, definition: PhaseDefinition): Set<WorldFact> {
    const seen = new Set<WorldFact>();
    for (const [, base] of WORLDS) {
      for (const signalKind of SIGNAL_KINDS) {
        decide(entityIn(kind, definition), signal(signalKind), observed(base, seen));
      }
    }
    return seen;
  }

  /**
   * Reads the driver performs today that its phase does not declare.
   *
   * **Empty, and it is meant to stay that way.** It used to hold six entries,
   * all one cause: on an `approved` signal `decide` normalized the *whole*
   * snapshot — every PR, not the phase's own — to ask which gate the approval
   * released, and in an epic phase with no review-reading gate that was a read
   * of a fact the tick never materializes. The driver now asks that question
   * only of gates that declare `artifact.reviews`, so a phase with none does
   * not touch the snapshot at all and the gap is closed rather than waived.
   *
   * Kept as a list so a future exception has somewhere to be argued for, in
   * writing, instead of being tucked into the assertion.
   */
  const KNOWN_GAPS: readonly string[] = [];

  it("never consults a fact outside the phase's declared set", () => {
    const undeclared = new Set<string>();

    for (const [kind, definition] of PHASES) {
      const declared = new Set(factsReadBy(kind, definition.name));
      for (const [, base] of WORLDS) {
        for (const signalKind of SIGNAL_KINDS) {
          const seen = new Set<WorldFact>();
          decide(entityIn(kind, definition), signal(signalKind), observed(base, seen));
          for (const fact of seen) {
            if (!declared.has(fact)) {
              undeclared.add(`${kind}/${definition.name} on ${signalKind} reads ${fact}`);
            }
          }
        }
      }
    }

    const unexpected = [...undeclared].filter((gap) => !KNOWN_GAPS.includes(gap)).sort();
    expect(unexpected).toEqual([]);
  });

  it("actually reaches the branches whose reads the declarations exist for", () => {
    for (const [kind, definition] of PHASES) {
      const required = OBSERVED_AT_LEAST[`${kind}/${definition.name}`];
      if (!required) continue;
      expect([...sweep(kind, definition)].sort()).toEqual(
        expect.arrayContaining([...required].sort()),
      );
    }
  });
});

describe("guidance is inert on purpose, not by omission", () => {
  it("is declared by no phase, and read by nothing in the driver", () => {
    // Both halves matter. Nothing produces `guidance_changed` and no predicate
    // reads `guidanceHashes`, so declaring the fact would buy a content-hash
    // request per tick that nothing consumes — see the note on `WorldFact`.
    // The day a producer exists, the sweep above fails until `guidance` gets a
    // declaration site, which is exactly when that question should be asked.
    const declaring = PHASES.filter(([kind, definition]) =>
      factsReadBy(kind, definition.name).includes("guidance"),
    ).map(([kind, definition]) => `${kind}/${definition.name}`);

    expect(declaring).toEqual([]);

    const readers = PHASES.filter(([kind, definition]) => {
      const seen = new Set<WorldFact>();
      for (const [, base] of WORLDS) {
        for (const signalKind of SIGNAL_KINDS) {
          decide(entityIn(kind, definition), signal(signalKind), observed(base, seen));
        }
      }
      return seen.has("guidance");
    });

    expect(readers).toEqual([]);
  });
});
