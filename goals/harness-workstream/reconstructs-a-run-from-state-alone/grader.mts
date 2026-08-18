/**
 * The grader: the account meets the expectation, field by field.
 *
 * This is the first and only place the two touch. The reader derived the
 * account knowing nothing about what the run was asked to do; everything here
 * compares parsed fields against parsed fields. No `includes`, no `indexOf`
 * over a rendered blob, no locating a region in prose.
 *
 * `goal.md` is the contract. Three invariants live here because they are about
 * this code rather than about the check's outcome.
 *
 * ## 1. A per-run judgement is handed a {@link RunView}, never the account
 *
 * Five separate defects were one sentence: a pooled value consumed inside a
 * per-run judgement, so one run's evidence excused another run's absence. Each
 * was fixed with a `runId ===` filter and the next review found another. The
 * fix is structural — {@link gradeRun} receives one run's view and the other
 * runs are not in scope, so a pooled read is unreachable rather than filtered.
 * Only {@link gradeAccount} sees across runs, and it makes no per-run claim.
 *
 * ## 2. Every finding names the branch that produced it
 *
 * `Finding.because` is a stable branch tag and the goal's self-check asserts on
 * it. Without it a guard case can be satisfied by the WRONG branch and be
 * indistinguishable from a working guard — which happened: deleting A4's
 * missing-report condition left the ordering comparison to handle that case,
 * `null` coerced against `0`, and the resulting failure satisfied a status-only
 * assertion perfectly.
 *
 * ## 3. An absent value is never silently skipped
 *
 * Every `null` check below is one of two things, decided explicitly and said
 * out loud at the site: **correctly not applicable** (another assertion owns
 * it), or **unevaluable, therefore a failure**. A skipped comparison certifies,
 * and a check that certifies on an empty input is the exact defect this whole
 * epic exists to remove.
 *
 * ## The run's prose is out of reach, structurally
 *
 * {@link GradeableView} narrows `said` to positions only, so "grade whether the
 * run did a GOOD job" is a compile error rather than a rule to remember.
 */
import type { Account, DidEntry, RunView, StreamMutation } from "./reader.mts";
import { sameFile } from "./paths.mts";

/** What the run was asked to touch. Held out — the reader never sees it. */
export interface Expectation {
  /**
   * The paths the job named. Basenames must be distinct, enforced at setup:
   * trailing-segment matching cannot be ambiguous.
   */
  paths: string[];
}

/** One run's view, with the run's own words removed. See the header. */
export type GradeableView = Omit<RunView, "said"> & {
  said: Array<{ at: number | null }>;
};

/** The account, with every run's words removed. */
export type GradeableAccount = Omit<Account, "runs"> & { runs: GradeableView[] };

/** How one assertion resolved. `unmeasured` is reported, never counted as a pass. */
export type FindingStatus = "pass" | "fail" | "unmeasured";

/** One assertion's verdict, with the reason it reached it. */
export interface Finding {
  /** `A1`…`A7`. `A8` is graded over the deprived sources and added by the runner. */
  id: string;
  status: FindingStatus;
  /** Which branch produced this. Stable, and what the self-check asserts on. */
  because: string;
  message: string;
}

/** The eight assertions, in the order §10 states them. */
export const ASSERTIONS: Record<string, string> = {
  A0: "the account holds the one run this check grades",
  A1: "every held-out path is present with a recorded kind and a settled outcome",
  A2: "the two surfaces name the same mutations, or a gap row accounts for the difference",
  A3: "the stream's order is non-decreasing over itemIndex, across at least two positions",
  A4: "the run's last mutation precedes the report it wrote about that activity",
  A5: "the plan half resolves to rows or to UNMEASURED — never to LOST",
  A6: "every count an assertion reads is greater than zero",
  A7: "no collection page was left unfollowed",
  A8: "the deprived sources import nothing that could reach the transcript, tree or git",
};

/** An outcome that says how the mutation ended. `pending` and absent do not. */
const SETTLED = new Set(["applied", "failed"]);

/** Rows this run holds for one expected path, by trailing path segments. */
function entriesFor(view: GradeableView, path: string): DidEntry[] {
  return view.did.filter((d) => sameFile(d.topic, path));
}

/** What to call a row in a message: the path the run used, else its key. */
function nameOf(entry: DidEntry): string {
  return entry.path ?? entry.topic;
}

/**
 * A1 — every held-out path present, with a kind and a settled outcome.
 *
 * The split that matters: a missing path with no successful shell call in THIS
 * run is the graph having lost a mutation; a missing path with one is work that
 * went through a channel the record does not cover. `allowedTools` is a
 * permission allowlist rather than an availability filter, so the run reaching
 * for the shell is real and measured — and a call the harness REFUSED changed
 * nothing, so it must not soften the verdict.
 */
function gradePaths(view: GradeableView, expectation: Expectation): Finding[] {
  if (expectation.paths.length === 0) {
    return [
      {
        id: "A1",
        status: "fail",
        because: "a1-no-expectation",
        message: "the expectation names no path, so A1 read an empty set and could not be evaluated",
      },
    ];
  }

  const findings: Finding[] = [];
  let unmeasured = 0;
  for (const path of expectation.paths) {
    const entries = entriesFor(view, path);
    if (entries.length > 1) {
      // Two rows could be this path. Grading both would grade a file the job
      // never named; grading either would be a guess. Neither is evidence.
      findings.push({
        id: "A1",
        status: "fail",
        because: "a1-ambiguous",
        message:
          `"${path}" matches ${entries.length} rows in this run's file record ` +
          `(${entries.map((e) => e.topic).join(", ")}) — the record cannot be resolved to one ` +
          `file, so nothing can be said about whether this path was recorded`,
      });
      continue;
    }
    if (entries.length === 0) {
      if (view.shell.succeeded > 0) {
        unmeasured += 1;
        findings.push({
          id: "A1",
          status: "unmeasured",
          because: "a1-missing-with-shell",
          message:
            `"${path}" has no row in this run's file record, and the run ran ` +
            `${view.shell.succeeded} shell call(s) — shell-driven edits are invisible to the ` +
            `recorder by design, so this path is unmeasured rather than lost`,
        });
        continue;
      }
      if (view.shell.calls > 0) {
        findings.push({
          id: "A1",
          status: "fail",
          because: "a1-missing-shell-denied",
          message:
            `"${path}" has no row in this run's file record. The run made ${view.shell.calls} ` +
            `shell call(s) but none of them ran, so none could have made this change`,
        });
        continue;
      }
      findings.push({
        id: "A1",
        status: "fail",
        because: "a1-missing-no-shell",
        message:
          `"${path}" has no row in this run's file record and the run made no shell call — ` +
          `nothing else could have made the change, so the graph lost it`,
      });
      continue;
    }
    for (const entry of entries) {
      if (entry.kind === null) {
        findings.push({
          id: "A1",
          status: "fail",
          because: "a1-no-kind",
          message: `the row for "${nameOf(entry)}" records no kind — state does not say how the run touched it`,
        });
      }
      if (entry.outcome === null) {
        findings.push({
          id: "A1",
          status: "fail",
          because: "a1-no-outcome",
          message:
            `the row for "${nameOf(entry)}" carries no outcome field at all — it is exposed ` +
            `through clientData, so absence means it was projected away, not that it is false`,
        });
      } else if (!SETTLED.has(entry.outcome)) {
        findings.push({
          id: "A1",
          status: "fail",
          because: "a1-unsettled",
          message:
            `the row for "${nameOf(entry)}" is still "${entry.outcome}" after the run finished — ` +
            `the settle path did not run, and a finished run should have no unsettled write`,
        });
      }
    }
  }

  if (unmeasured === expectation.paths.length) {
    findings.push({
      id: "A1",
      status: "fail",
      because: "a1-all-unmeasured",
      message:
        `INCONCLUSIVE — all ${expectation.paths.length} expected path(s) were unmeasured because ` +
        `the run worked through the shell. This run proved nothing about whether state can say ` +
        `what a run did, which is not a pass`,
    });
  }
  if (findings.length === 0) {
    findings.push({
      id: "A1",
      status: "pass",
      because: "a1-ok",
      message: `${expectation.paths.length} of ${expectation.paths.length} held-out paths present, each with a kind and a settled outcome`,
    });
  }
  return findings;
}

/**
 * The record must be right about WHAT happened, not merely populated.
 *
 * A1 requires a kind and a settled outcome; neither says the record agrees with
 * the operation the stream shows. Both halves are defects the recorder has
 * actually shipped: `Write` classified as `created` whatever it did to an
 * existing file, and a settled outcome reusing the call-time value rather than
 * the harness's confirmed result.
 *
 * **Preference-shaped**: it only has teeth where the two sides disagree, so a
 * guard case built from a coherent record exercises none of it.
 */
function compareSemantics(mutation: StreamMutation, entry: DidEntry): Finding[] {
  const findings: Finding[] = [];

  // NOT APPLICABLE, twice over and decided explicitly. A row carrying no kind
  // is absence, which A1 fails on where the path was expected and §9 reports
  // where it was not. And `mutation.kind === null` means the TOOL NAME does not
  // determine the kind — a `Write` over an existing file is an edit — so the
  // stream makes no claim to compare against. Inventing one would fail faithful
  // state while passing a recorder that mislabels an overwrite.
  if (entry.kind !== null && mutation.kind !== null && entry.kind !== mutation.kind) {
    findings.push({
      id: "A2",
      status: "fail",
      because: "a2-kind-disagrees",
      message:
        `the record says "${nameOf(entry)}" was ${JSON.stringify(entry.kind)}, but the item ` +
        `stream shows a ${mutation.tool}, which is ${JSON.stringify(mutation.kind)} — the ` +
        `record is wrong about what the run did to this file`,
    });
  }

  // UNEVALUABLE, therefore a FAILURE. The item's terminal status could not be
  // translated, so the stream says nothing about how this mutation ended — and
  // skipping the comparison lets a row asserting `applied` stand on no
  // corroboration at all. An empty input certifying instead of declaring itself
  // unmeasured is the precise defect this check exists to detect, and it was
  // sitting inside the check.
  // UNEVALUABLE, therefore a FAILURE. A1 only looks at the held-out paths, so a
  // file the run touched incidentally can pair with a row that cannot say how it
  // ended and nothing else would notice. §9 says report rather than fail a file
  // the fixture did not name — that is about its PRESENCE, not about a row that
  // exists and is silent on its own outcome.
  if (entry.outcome === null) {
    findings.push({
      id: "A2",
      status: "fail",
      because: "a2-row-outcome-missing",
      message:
        `the record holds a row for "${nameOf(entry)}" with no outcome at all, so state cannot ` +
        `say how that mutation ended — and the path is not one A1 checks`,
    });
  } else if (mutation.outcome === null) {
    findings.push({
      id: "A2",
      status: "fail",
      because: "a2-outcome-unevaluable",
      message:
        `the item stream shows "${mutation.path}" ending as ${JSON.stringify(mutation.status)}, ` +
        `which says nothing about how it settled — so the record's ` +
        `${JSON.stringify(entry.outcome)} is a claim nothing corroborates`,
    });
  } else if (entry.outcome !== mutation.outcome) {
    findings.push({
      id: "A2",
      status: "fail",
      because: "a2-outcome-disagrees",
      message:
        `the record settled "${nameOf(entry)}" as ${JSON.stringify(entry.outcome)}, but the item ` +
        `stream shows the call ${mutation.status}, which is ` +
        `${JSON.stringify(mutation.outcome)} — the record is wrong about how it turned out`,
    });
  }
  return findings;
}

/**
 * A2 — this run's item stream and this run's file record name the same mutations.
 *
 * A disagreement fails ONLY when no gap row accounts for it. The recorder is
 * allowed to skip — watching the work must never break the work — so what is
 * caught here is narrower and sharper than "the two surfaces differ": it is
 * *the graph lost something without admitting it*.
 *
 * Gaps are **consumed**, not matched. The recorder writes one row per
 * unrecordable mutation, so one gap excuses one loss; `.find()` would hand the
 * same row to two mutations sharing a path and certify a state that lost one.
 */
function gradeAgreement(view: GradeableView): Finding[] {
  const findings: Finding[] = [];

  if (view.streamMutations.length === 0 && view.did.length === 0) {
    return [
      {
        id: "A2",
        status: "fail",
        because: "a2-both-empty",
        message:
          "neither surface shows a mutation — the item stream carries no file-tool call and the " +
          "file record holds no row, so the agreement claim read an empty set on both sides",
      },
    ];
  }

  let accounted = 0;
  // A gap excuses a missing FILE row only if it says that is what it covers.
  // `kind` is a closed set on the row, so this is a field comparison rather
  // than a guess — a plan gap sitting in the same run is not evidence about a
  // mutation, and a gap that names no subject is not evidence about anything.
  const namedGaps = view.gaps.filter((g) => g.kind === "file" && g.rawPath !== null);
  for (const mutation of view.streamMutations) {
    const rows = view.did.filter((d) => sameFile(d.topic, mutation.path));
    if (rows.length > 1) {
      // Accepting any one would let a genuinely missing record hide behind a
      // different row sharing a tail — the exact failure this assertion exists
      // to catch.
      findings.push({
        id: "A2",
        status: "fail",
        because: "a2-ambiguous-mutation",
        message:
          `"${mutation.path}" could be ${rows.length} different rows ` +
          `(${rows.map((r) => r.topic).join(", ")}) — the two surfaces cannot be paired, so ` +
          `whether this mutation was recorded is unresolvable rather than fine`,
      });
      continue;
    }
    if (rows.length === 1) {
      // ORDER IS LOAD-BEARING. The gap exemption below must never be reached
      // while a row exists: a gap explains a mutation the collection is
      // MISSING, and does not license a row that is present and wrong.
      findings.push(...compareSemantics(mutation, rows[0]));
      continue;
    }
    const gapIndex = namedGaps.findIndex((g) => sameFile(g.rawPath as string, mutation.path));
    if (gapIndex !== -1) {
      namedGaps.splice(gapIndex, 1);
      accounted += 1;
      continue;
    }
    findings.push({
      id: "A2",
      status: "fail",
      because: "a2-unaccounted",
      message:
        `"${mutation.path}" appears in the item stream as a ${mutation.tool}, has no row in the ` +
        `file record, and no UNCONSUMED gap row accounts for it: the graph lost a tool-driven ` +
        `mutation without admitting it`,
    });
  }

  for (const entry of view.did) {
    // Recomputed from the arrays, not read off `entry.namedBy`: a count derived
    // beside the array it describes can drift from it.
    const naming = view.streamMutations.filter((m) => sameFile(m.path, entry.topic)).length;
    if (naming > 1) {
      findings.push({
        id: "A2",
        status: "fail",
        because: "a2-ambiguous-row",
        message:
          `the row keyed "${entry.topic}" is named by ${naming} stream mutations — which ` +
          `operation it records is unresolvable, so it cannot corroborate any of them`,
      });
      continue;
    }
    if (naming === 1) continue;
    findings.push({
      id: "A2",
      status: "fail",
      because: "a2-row-without-stream",
      message:
        `the file record holds a row keyed "${entry.topic}" that this run's item stream does not ` +
        `show — the record claims an operation nothing else evidences`,
    });
  }

  // A mutation the recorder could not key leaves a `file` gap carrying NO path.
  // Disjoint from the named-path pool above by construction (`rawPath === null`
  // versus `!== null`), and narrowed to this run's file skips by `kind`.
  //
  // This was a counting bound until the gap row gained `kind`: a plan gap and
  // an unkeyable-file gap were indistinguishable without parsing prose, so any
  // pathless gap could stand in for any pathless skip. It now answers only to
  // gaps that say they cover a file.
  const pathlessGaps = view.gaps.filter((g) => g.kind === "file" && g.rawPath === null).length;
  if (pathlessGaps < view.mutationsWithNoPath) {
    findings.push({
      id: "A2",
      status: "fail",
      because: "a2-pathless-no-gap",
      message:
        `this run made ${view.mutationsWithNoPath} file-tool call(s) with no path to key them ` +
        `under and wrote ${pathlessGaps} pathless gap row(s) of kind "file" — a skip that leaves ` +
        `nothing behind is indistinguishable from a mutation that never happened`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "A2",
      status: "pass",
      because: "a2-ok",
      message:
        `${view.streamMutations.length} stream mutation(s) and ${view.did.length} recorded ` +
        `row(s) name the same files` +
        (accounted > 0 ? `; ${accounted} difference(s) accounted for by a gap row` : ""),
    });
  }
  return findings;
}

/**
 * A3 — the stream is in order, and there is enough of it to say so.
 *
 * Non-decreasing, never contiguous: the measured values carry a duplicate and a
 * gap, both legitimate. An unreadable index is a failure, not a skip — guarding
 * on "did we read any numbers" is what let the predecessor's ordering assertion
 * pass having measured nothing.
 */
function gradeOrder(view: GradeableView): Finding[] {
  const run = view.order;
  if (run.unreadable > 0) {
    return [
      {
        id: "A3",
        status: "fail",
        because: "a3-unreadable",
        message:
          `${run.unreadable} of ${run.unreadable + run.indices.length} top-level items carry no ` +
          `numeric itemIndex, so there is no evidence for the in-order claim`,
      },
    ];
  }
  const distinct = new Set(run.indices).size;
  if (distinct < 2) {
    return [
      {
        id: "A3",
        status: "fail",
        because: "a3-too-few-positions",
        message:
          `this run produced ${distinct} distinct stream position(s) — fewer than two, so ` +
          `ordering is unverifiable`,
      },
    ];
  }
  if (run.indices.some((v, i) => i > 0 && v < run.indices[i - 1])) {
    return [
      {
        id: "A3",
        status: "fail",
        because: "a3-out-of-order",
        message: `this run is not in order: itemIndex ${run.indices.join(",")}`,
      },
    ];
  }
  return [
    {
      id: "A3",
      status: "pass",
      because: "a3-ok",
      message: `non-decreasing across ${run.indices.length} top-level item(s) at ${distinct} distinct position(s)`,
    },
  ];
}

/**
 * A4 — the run reported on the acting, and nothing followed the report.
 *
 * Graded on the LAST mutation, not the first. `write@1, report@2, write@3` has
 * activity preceding a report and a report covering none of the work after it,
 * and a first-activity comparison certifies it. Mutations rather than every
 * tool call: a `Read` after the closing word changes nothing.
 *
 * A tie is unevaluable, not a pass — `itemIndex` carries duplicates, so equal
 * positions say nothing about which came first, and A4's claim is causal.
 */
function gradeCausality(view: GradeableView): Finding[] {
  const run = view.order;

  // UNEVALUABLE, therefore a FAILURE: `lastMutationAt` was computed from the
  // positions that could be read, so a dropped one means the comparison
  // describes a smaller set than it claims. A sub-agent's mutation is not
  // top-level, so A3's `unreadable` does not cover this.
  if (run.unreadableMutationPositions > 0) {
    return [
      {
        id: "A4",
        status: "fail",
        because: "a4-unreadable-mutation",
        message:
          `${run.unreadableMutationPositions} mutation(s) carry no readable stream position, so ` +
          `"nothing followed the report" would be asserted over a subset of the run's writes`,
      },
    ];
  }
  // NOT APPLICABLE, decided explicitly: a MESSAGE whose position cannot be read
  // would shrink `lastMessageAt` the same way, but messages are top-level and
  // A3's `unreadable` already fails on any top-level item without an index. A
  // sub-agent's mutation is not top-level, which is why that one needed its own
  // count above.
  const last = run.lastMutationAt;
  const word = run.lastMessageAt;
  if (last === null || word === null) {
    return [
      {
        id: "A4",
        status: "fail",
        because: "a4-unevaluable",
        message:
          `this run carries ${last === null ? "no file mutation" : "no message"} at a readable ` +
          `position, so "activity preceded the report" could not be evaluated`,
      },
    ];
  }
  if (last === word) {
    return [
      {
        id: "A4",
        status: "fail",
        because: "a4-tied",
        message:
          `this run last changed a file at position ${last} and last spoke at the same position ` +
          `— itemIndex carries duplicates, so which came first is not recoverable`,
      },
    ];
  }
  if (last > word) {
    return [
      {
        id: "A4",
        status: "fail",
        because: "a4-activity-after-report",
        message:
          `this run last changed a file at position ${last}, AFTER its final message at ` +
          `${word} — the record holds a mutation the report never covered`,
      },
    ];
  }
  return [
    {
      id: "A4",
      status: "pass",
      because: "a4-ok",
      message: `mutations ${run.firstMutationAt}-${last}, last word at ${word}`,
    },
  ];
}

/**
 * A5 — the plan half: rows, or UNMEASURED with its reason named. Never LOST.
 *
 * UNMEASURED is the expected arm on this driver and does not fail the goal —
 * the kill line deliberately does not ride on it. It is still reported and
 * logged per run, so a drift toward never measuring anything stays visible.
 *
 * The ROWS branch has never executed against a real run and will not until the
 * driver changes (FIX-1185), which is why the self-check feeds it directly. A
 * branch no run reaches cannot be mutation-tested through a run.
 */
function gradePlan(view: GradeableView): Finding[] {
  const { rows, toolCalls } = view.plan;
  if (rows.length === 0) {
    if (toolCalls > 0) {
      return [
        {
          id: "A5",
          status: "fail",
          because: "a5-lost",
          message: `the plan tools fired ${toolCalls} time(s) in this run and no row was recorded — our bug`,
        },
      ];
    }
    return [
      {
        id: "A5",
        status: "unmeasured",
        because: "a5-unmeasured",
        message:
          `this run invoked no plan tool in its own item stream, so nothing was measured about ` +
          `the plan half. Tools it did use: ${view.toolNamesSeen.join(", ") || "(none)"}`,
      },
    ];
  }

  const findings: Finding[] = [];
  const untitled = rows.filter((r) => r.title === null || r.title.length === 0);
  if (untitled.length > 0) {
    findings.push({
      id: "A5",
      status: "fail",
      because: "a5-untitled",
      message:
        `${untitled.length} of ${rows.length} plan rows in this run carry no wording — the record ` +
        `says an item existed without saying what the run thought it was`,
    });
  }
  if (!rows.some((r) => r.status !== null)) {
    findings.push({
      id: "A5",
      status: "fail",
      because: "a5-no-status",
      message: "no plan row in this run carries a status — the record cannot answer whether any item moved",
    });
  }
  if (findings.length === 0) {
    findings.push({
      id: "A5",
      status: "pass",
      because: "a5-ok",
      message: `${rows.length} plan row(s) from ${toolCalls} plan tool call(s)`,
    });
  }
  return findings;
}

/**
 * A6 — no assertion read an empty set. Each emptiness fails by its own name.
 *
 * Where a set is one the OTHER assertions iterate, its size is taken from that
 * set rather than from a count beside it. A count can drift from its array, and
 * then A6 reports "fine" about a set A1 and A2 never saw.
 */
function gradeCounts(view: GradeableView): Finding[] {
  const required: Array<[string, number, string]> = [
    ["items", view.counts.items, "this run's item stream is empty — a run that completes with nothing recorded"],
    ["topLevel", view.counts.topLevel, "no item is top-level, so the run's own thread could not be read"],
    ["messages", view.said.length, "no top-level message, so A4 has nothing to place the activity against"],
    ["toolOutputs", view.counts.toolOutputs, "no top-level tool_output, so the run reported without doing anything"],
    ["fileRows", view.did.length, "this run's file record is empty, so A1 and A2 read an empty set"],
  ];
  const empty = required.filter(([, n]) => n === 0);
  if (empty.length > 0) {
    return empty.map(([name, , why]) => ({
      id: "A6",
      status: "fail" as const,
      because: `a6-empty:${name}`,
      message: `count "${name}" is zero: ${why}`,
    }));
  }
  return [
    {
      id: "A6",
      status: "pass",
      because: "a6-ok",
      message: required.map(([name, n]) => `${name} ${n}`).join(" · "),
    },
  ];
}

/**
 * A7 — every cursor followed, on all three of this run's collection reads.
 *
 * A single-page read under-reads silently, which is the same failure as an
 * empty set: the assertion grades a fragment while reporting on the whole.
 */
function gradePaging(view: GradeableView, collections: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const collection of collections) {
    const report = view.reads[collection];
    if (report === undefined) {
      findings.push({
        id: "A7",
        status: "fail",
        because: "a7-never-read",
        message: `"${collection}" was never read for this run, so its rows informed no assertion`,
      });
      continue;
    }
    if (report.truncated) {
      findings.push({
        id: "A7",
        status: "fail",
        because: "a7-truncated",
        message:
          `"${collection}" still had a nextCursor after ${report.pages} page(s) — the read ` +
          `stopped short and every count derived from it is a fragment`,
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      id: "A7",
      status: "pass",
      because: "a7-ok",
      message: collections
        .map((c) => `${c}: ${view.reads[c].pages} page(s), ${view.reads[c].rows} row(s)`)
        .join(" · "),
    });
  }
  return findings;
}

/**
 * Every per-run assertion, over ONE run's view.
 *
 * The signature is the guard: nothing here can reach another run's rows, gaps,
 * shell calls or plan, because they are not in scope. That is what closes the
 * pooled-value class rather than another `runId ===` filter.
 */
export function gradeRun(view: GradeableView, expectation: Expectation, collections: string[]): Finding[] {
  return [
    ...gradePaths(view, expectation),
    ...gradeAgreement(view),
    ...gradeOrder(view),
    ...gradeCausality(view),
    ...gradePlan(view),
    ...gradeCounts(view),
    ...gradePaging(view, collections),
  ];
}

/**
 * Grade the account for the one run this check dispatched.
 *
 * `runId` is an ADDRESS, not an answer: the runner knows which run it started
 * and says so, rather than the grader guessing. An account holding a run the
 * caller did not name is a state this check cannot attribute an expectation to,
 * and it fails rather than picking one.
 */
export function grade(
  account: GradeableAccount,
  expectation: Expectation,
  collections: string[],
  runId: string,
): Finding[] {
  if (account.counts.requests === 0) {
    return [
      {
        id: "A0",
        status: "fail",
        because: "a0-no-requests",
        message: "the workstream has no request history at all, so nothing below could be derived",
      },
    ];
  }
  if (account.runs.length !== account.counts.requests) {
    return [
      {
        id: "A0",
        status: "fail",
        because: "a0-request-dropped",
        message:
          `the route returned ${account.counts.requests} request(s) and only ` +
          `${account.runs.length} could be read as a run — a request dropped before it reached ` +
          `any assertion is an absence nothing downstream can see`,
      },
    ];
  }
  const view = account.runs.find((r) => r.runId === runId);
  if (view === undefined) {
    return [
      {
        id: "A0",
        status: "fail",
        because: "a0-run-missing",
        message:
          `the account holds no view for run "${runId}" (it holds ` +
          `${account.runs.map((r) => r.runId).join(", ") || "none"}) — the run this check ` +
          `dispatched is not in the state it read`,
      },
    ];
  }
  return gradeRun(view, expectation, collections);
}

/** The failing findings, which are the goal's failures verbatim. */
export function failuresOf(findings: Finding[]): string[] {
  return findings
    .filter((f) => f.status === "fail")
    .map((f) => `${f.id} (${ASSERTIONS[f.id] ?? "unknown assertion"}): ${f.message}`);
}
