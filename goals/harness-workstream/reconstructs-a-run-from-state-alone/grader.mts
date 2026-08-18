/**
 * The grader: the account meets the expectation, field by field.
 *
 * This is the first and only place the two touch. The reader derived the
 * account knowing nothing about what the run was asked to do; everything here
 * is a comparison of parsed fields against parsed fields. No `includes`, no
 * `indexOf` over a rendered blob, no locating a region in prose — that is the
 * grading style FIX-1184 exists to retire, and it produces new defects faster
 * than guards can be bolted onto it.
 *
 * ## Every assertion has a can't-tell branch
 *
 * An assertion whose input set is empty **fails and names itself** rather than
 * passing vacuously. That is the entire reason this issue exists: a check that
 * cannot see what it claims to measure reports "fine", and a blind check HERE
 * would report that the epic succeeded when it hadn't.
 *
 * Two arms report instead of failing, and neither may pass silently:
 *
 * - **A5 UNMEASURED** — the run never invoked a plan tool, so the plan half was
 *   not exercised. Measured behaviour on this driver, not a defect (FIX-1185).
 * - **A1 per-path unmeasured** — the path is absent AND the run called the
 *   shell. Shell-driven edits are invisible to the recorder by design, so
 *   failing would blame the graph for a stated gap. If EVERY expected path
 *   lands here the run proved nothing, and that is an INCONCLUSIVE failure
 *   rather than a green one.
 *
 * ## Every finding names the branch that produced it
 *
 * `Finding.because` is a stable branch tag, and it is not decoration: the
 * goal's own self-check asserts on it. Without it a guard case can be satisfied
 * by the WRONG branch and be indistinguishable from a working guard — which
 * happened here. Deleting A4's missing-report condition left the ordering
 * comparison to handle that case, `firstToolOutputAt > null` coerced to a
 * comparison against `0`, and the resulting "the run reported before it acted"
 * satisfied a status-only assertion perfectly. The tag is the same structured,
 * field-specific grading the rest of this file insists on, turned on itself.
 *
 * ## The run's prose is out of reach, structurally
 *
 * {@link GradeableAccount} narrows `said` to positions only. Passing a full
 * account still typechecks, but nothing in this module can reference the text,
 * so "grade whether the run did a GOOD job" is a compile error rather than a
 * rule someone has to remember. The anti-game forbids asserting on the run's
 * wording, on any file's contents, and on how the run was settled.
 */
import type { Account, DidEntry, StreamMutation } from "./reader.mts";
import { sameFile } from "./paths.mts";

/** What the run was asked to touch. Held out — the reader never sees it. */
export interface Expectation {
  /**
   * The paths the job named. Basenames must be distinct, enforced at setup:
   * trailing-segment matching cannot be ambiguous.
   */
  paths: string[];
}

/** The account, with the run's own words removed. See the header. */
export type GradeableAccount = Omit<Account, "said"> & {
  said: Array<{ at: number | null }>;
};

/** How one assertion resolved. `unmeasured` is reported, never counted as a pass. */
export type FindingStatus = "pass" | "fail" | "unmeasured";

/** One assertion's verdict, with the reason it reached it. */
export interface Finding {
  /** `A1`…`A7`. `A8` is graded over the reader's source and is added by the runner. */
  id: string;
  status: FindingStatus;
  /** Which branch produced this. Stable, and what the self-check asserts on. */
  because: string;
  message: string;
}

/** The eight assertions, in the order §10 states them. */
export const ASSERTIONS: Record<string, string> = {
  A1: "every held-out path is present with a recorded kind and a settled outcome",
  A2: "the two surfaces name the same mutations, or a gap row accounts for the difference",
  A3: "the stream's order is non-decreasing over itemIndex, across at least two positions",
  A4: "the run's activity precedes the report it wrote about that activity",
  A5: "the plan half resolves to rows or to UNMEASURED — never to LOST",
  A6: "every count an assertion reads is greater than zero",
  A7: "no collection page was left unfollowed",
  A8: "the reader imports nothing that could reach the transcript, tree or git",
};

/** An outcome that says how the mutation ended. `pending` and absent do not. */
const SETTLED = new Set(["applied", "failed"]);

/**
 * Rows the collection holds for one expected path, across every run namespace.
 *
 * Matched against the row's TOPIC — its key, verbatim — by trailing path
 * segments. The namespace segments in front of the path are simply extra
 * leading segments a suffix match ignores, so the comparison survives the key
 * layout changing, which it already has once.
 */
function entriesFor(account: GradeableAccount, path: string): DidEntry[] {
  return account.did.filter((d) => sameFile(d.topic, path));
}

/** What to call a row in a message: the path the run used, else its key. */
function nameOf(entry: DidEntry): string {
  return entry.path ?? entry.topic;
}

/**
 * A1 — every held-out path present, with a kind and a settled outcome.
 *
 * The split that matters: a missing path with no shell call in the run is the
 * graph having lost a mutation, and a missing path with one is work that went
 * through a channel the record does not cover. Those need opposite verdicts,
 * and `allowedTools` is a permission allowlist rather than an availability
 * filter, so the run reaching for the shell is a real and measured possibility.
 */
function gradePaths(account: GradeableAccount, expectation: Expectation): Finding[] {
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
    const entries = entriesFor(account, path);
    const perRun = new Map<string, DidEntry[]>();
    for (const entry of entries) {
      perRun.set(entry.runId, [...(perRun.get(entry.runId) ?? []), entry]);
    }
    // WITHIN a run. A workstream is reused, so the same path recorded by two
    // runs is two faithful rows — reading that as ambiguity would fail a
    // correct record.
    const clash = [...perRun.values()].find((rows) => rows.length > 1);
    if (clash !== undefined) {
      // Two rows could be this path. Grading both would grade a file the job
      // never named; grading either would be a guess. Neither is evidence.
      findings.push({
        id: "A1",
        status: "fail",
        because: "a1-ambiguous",
        message:
          `"${path}" matches ${clash.length} rows within one run ` +
          `(${clash.map((e) => e.topic).join(", ")}) — the record cannot be resolved to one ` +
          `file, so nothing can be said about whether this path was recorded`,
      });
      continue;
    }
    if (entries.length === 0) {
      if (account.shell.succeeded > 0) {
        unmeasured += 1;
        findings.push({
          id: "A1",
          status: "unmeasured",
          because: "a1-missing-with-shell",
          message:
            `"${path}" has no row in the file record, and the run ran ${account.shell.succeeded} ` +
            `shell call(s) — shell-driven edits are invisible to the recorder by design, so ` +
            `this path is unmeasured rather than lost`,
        });
        continue;
      }
      if (account.shell.calls > 0) {
        // The run reached for the shell and the harness refused it. A call that
        // never ran cannot have made the change, so this is a loss like any
        // other — softening it here is how a lost write becomes an inconclusive.
        findings.push({
          id: "A1",
          status: "fail",
          because: "a1-missing-shell-denied",
          message:
            `"${path}" has no row in the file record. The run made ${account.shell.calls} shell ` +
            `call(s) but none of them ran, so none could have made this change — the graph lost it`,
        });
        continue;
      }
      findings.push({
        id: "A1",
        status: "fail",
        because: "a1-missing-no-shell",
        message:
          `"${path}" has no row in the file record and the run made no shell call — nothing ` +
          `else could have made the change, so the graph lost it`,
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
            `the row for "${nameOf(entry)}" carries no outcome field at all — it is exposed through ` +
            `clientData, so absence means it was projected away, not that it is false`,
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
 * A2 — the item stream and the file record name the same mutations.
 *
 * A disagreement fails ONLY when no gap row accounts for it. The recorder is
 * allowed to skip — watching the work must never break the work — so the
 * failure being caught here is narrower and sharper than "the two surfaces
 * differ": it is *the graph lost something without admitting it*.
 *
 * A gap must carry THAT path. "Some gap exists" is not an account of this
 * particular loss, and a gap with no path at all accounts for nothing.
 */
function gradeAgreement(account: GradeableAccount): Finding[] {
  const findings: Finding[] = [];

  if (account.streamMutations.length === 0 && account.did.length === 0) {
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
  for (const mutation of account.streamMutations) {
    const rows = account.did.filter(
      (d) => d.runId === mutation.runId && sameFile(d.topic, mutation.path),
    );
    if (rows.length > 1) {
      // Accepting any one of them would let a genuinely missing record hide
      // behind a different row that happens to share a tail — the exact failure
      // this assertion exists to catch.
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
      // while a row exists, because a gap explains a mutation the collection is
      // MISSING — it does not license a row that is present and wrong. Those are
      // different claims, and collapsing them lets partial handling disguise
      // incomplete handling: the gap makes the discrepancy look accounted for
      // while the row still asserts a mutation nobody confirmed. A guard case
      // builds exactly that world.
      findings.push(...compareSemantics(mutation, rows[0]));
      continue;
    }
    const gap = account.gaps.find(
      (g) => g.runId === mutation.runId && g.rawPath !== null && sameFile(g.rawPath, mutation.path),
    );
    if (gap !== undefined) {
      accounted += 1;
      continue;
    }
    findings.push({
      id: "A2",
      status: "fail",
      because: "a2-unaccounted",
      message:
        `"${mutation.path}" appears in the item stream as a ${mutation.tool}, has no row in the ` +
        `file record, and no gap row accounts for it: the graph lost a tool-driven mutation ` +
        `without admitting it`,
    });
  }

  for (const entry of account.did) {
    // Recomputed from the arrays, not read off `entry.namedBy`. The reader
    // derives that count beside the array it describes, and a count that drifts
    // from its array is how A6 could once have reported "fine" about a set
    // nothing else could see. Same rule, other assertion.
    const naming = account.streamMutations.filter(
      (m) => m.runId === entry.runId && sameFile(m.path, entry.topic),
    ).length;
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
        `the file record holds a row keyed "${entry.topic}" that the run's own item stream does ` +
        `not show — the record claims an operation nothing else evidences`,
    });
  }

  if (account.counts.mutationsWithNoPath > 0 && account.gaps.length === 0) {
    findings.push({
      id: "A2",
      status: "fail",
      because: "a2-pathless-no-gap",
      message:
        `${account.counts.mutationsWithNoPath} file-tool call(s) carried no path to key them ` +
        `under and no gap row was written — a skip that leaves nothing behind is ` +
        `indistinguishable from a mutation that never happened`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "A2",
      status: "pass",
      because: "a2-ok",
      message:
        `${account.streamMutations.length} stream mutation(s) and ${account.did.length} recorded ` +
        `row(s) name the same files` +
        (accounted > 0 ? `; ${accounted} difference(s) accounted for by a gap row` : ""),
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
 * the harness's confirmed result. Under a populated-fields check alone, a record
 * saying "created" about an edit passes.
 *
 * This is a **preference-shaped** assertion — it only has teeth where the two
 * sides disagree, so a guard case built from a coherent record exercises none of
 * it. The cases carry a real disagreement for exactly that reason.
 *
 * The expectations are translated in the reader, so nothing here knows a tool
 * name. A field the record does not carry is absence, which A1 grades where the
 * path was expected and §9 reports rather than fails where it was not — so only
 * a populated field that DISAGREES is a failure.
 */
function compareSemantics(mutation: StreamMutation, entry: DidEntry): Finding[] {
  const findings: Finding[] = [];
  if (entry.kind !== null && entry.kind !== mutation.kind) {
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
  if (mutation.outcome !== null && entry.outcome !== null && entry.outcome !== mutation.outcome) {
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
 * A3 — the stream is in order, and there is enough of it to say so.
 *
 * Non-decreasing, never contiguous: the measured values carry a duplicate and a
 * gap, both legitimate. Graded per request, because `itemIndex` is an index
 * within one request's stream — flattening across requests first would report a
 * false failure the moment a workstream holds a second run. An unreadable index
 * is a failure, not a skip: guarding on "did we read any numbers" is what let
 * the predecessor's ordering assertion pass having measured nothing.
 */
function gradeOrder(account: GradeableAccount): Finding[] {
  if (account.order.runs.length === 0) {
    return [
      {
        id: "A3",
        status: "fail",
        because: "a3-no-stream",
        message: "no request carried a stream, so ordering could not be evaluated",
      },
    ];
  }
  const findings: Finding[] = [];
  for (const run of account.order.runs) {
    if (run.unreadable > 0) {
      findings.push({
        id: "A3",
        status: "fail",
        because: "a3-unreadable",
        message:
          `${run.unreadable} of ${run.unreadable + run.indices.length} top-level items in run ` +
          `${run.runId} carry no numeric itemIndex, so there is no evidence for the in-order claim`,
      });
      continue;
    }
    const distinct = new Set(run.indices).size;
    if (distinct < 2) {
      findings.push({
        id: "A3",
        status: "fail",
        because: "a3-too-few-positions",
        message:
          `run ${run.runId} produced ${distinct} distinct stream position(s) — fewer than two, ` +
          `so ordering is unverifiable`,
      });
      continue;
    }
    if (run.indices.some((v, i) => i > 0 && v < run.indices[i - 1])) {
      findings.push({
        id: "A3",
        status: "fail",
        because: "a3-out-of-order",
        message: `run ${run.runId} is not in order: itemIndex ${run.indices.join(",")}`,
      });
    }
  }
  if (findings.length === 0) {
    const total = account.order.runs.reduce((n, r) => n + r.indices.length, 0);
    const distinct = account.order.runs.reduce((n, r) => n + new Set(r.indices).size, 0);
    findings.push({
      id: "A3",
      status: "pass",
      because: "a3-ok",
      message: `non-decreasing across ${total} top-level item(s) at ${distinct} distinct position(s)`,
    });
  }
  return findings;
}

/**
 * A4 — the run reported on the acting, and nothing followed the report.
 *
 * Graded on the LAST mutation, not the first. `write@1, report@2, write@3` has
 * activity preceding a report and a report covering none of the work after it,
 * and a first-activity comparison certifies it — rejecting the world where ALL
 * activity follows the report while accepting the one where only some does.
 *
 * Mutations rather than every tool call: a `Read` after the closing word changes
 * nothing, so failing on it would be a false red on an ordinary run.
 *
 * The two can't-tell conditions are tested BEFORE the comparison and reported
 * under their own branch, because folding them lets `null` coerce to `0` in the
 * comparison and produce a perfectly plausible ordering failure for a run that
 * simply had no message. That is a guard passing for the wrong reason, and it
 * looks exactly like one that works.
 */
function gradeCausality(account: GradeableAccount): Finding[] {
  if (account.order.runs.length === 0) {
    return [
      {
        id: "A4",
        status: "fail",
        because: "a4-no-stream",
        message: "no request carried a stream, so causality could not be evaluated",
      },
    ];
  }
  const findings: Finding[] = [];
  for (const run of account.order.runs) {
    const lastActivity = run.lastMutationAt;
    const lastWord = run.lastMessageAt;
    if (lastActivity === null || lastWord === null) {
      findings.push({
        id: "A4",
        status: "fail",
        because: "a4-unevaluable",
        message:
          `run ${run.runId} carries ${lastActivity === null ? "no file mutation" : "no message"} ` +
          `at a readable position, so "activity preceded the report" could not be evaluated`,
      });
      continue;
    }
    if (lastActivity === lastWord) {
      // The POC measured `itemIndex` carrying duplicates, so a tie is ordinary
      // and says nothing about order. A4's claim is causal — the run acted, then
      // reported — and equality is exactly the case the data cannot support.
      // Certifying it would be a claim wider than the measurement that produced
      // the field.
      findings.push({
        id: "A4",
        status: "fail",
        because: "a4-tied",
        message:
          `run ${run.runId} last changed a file at position ${lastActivity} and last spoke at ` +
          `the same position — itemIndex carries duplicates, so which came first is not ` +
          `recoverable and the causal claim cannot be evaluated`,
      });
      continue;
    }
    if (lastActivity > lastWord) {
      findings.push({
        id: "A4",
        status: "fail",
        because: "a4-activity-after-report",
        message:
          `run ${run.runId} last changed a file at position ${lastActivity}, AFTER its final ` +
          `message at ${lastWord} — the record holds a mutation the report never covered`,
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      id: "A4",
      status: "pass",
      because: "a4-ok",
      message: account.order.runs
        .map(
          (r) =>
            `run ${r.runId}: mutations ${r.firstMutationAt}-${r.lastMutationAt}, last word at ` +
            `${r.lastMessageAt}`,
        )
        .join("; "),
    });
  }
  return findings;
}

/**
 * A5 — the plan half: rows, or UNMEASURED with its reason named. Never LOST.
 *
 * UNMEASURED is the expected arm on this driver and does not fail the goal —
 * the kill line deliberately does not ride on it. It is still reported and
 * logged per run, so a drift toward never measuring anything stays visible
 * rather than comfortable.
 *
 * The ROWS branch below has never executed against a real run and will not
 * until the driver changes (FIX-1185), which is exactly why the goal's
 * self-check feeds it directly. A branch no run reaches cannot be
 * mutation-tested through a run: the mutation never executes, and that green is
 * indistinguishable from the green of a guard that works.
 */
function gradePlan(account: GradeableAccount): Finding[] {
  const planned = account.planned;
  if (planned.arm === "LOST") {
    return [{ id: "A5", status: "fail", because: "a5-lost", message: `${planned.reason} — our bug` }];
  }
  if (planned.arm === "UNMEASURED") {
    return [{ id: "A5", status: "unmeasured", because: "a5-unmeasured", message: planned.reason }];
  }
  const findings: Finding[] = [];
  const untitled = planned.rows.filter((r) => r.title === null || r.title.length === 0);
  if (untitled.length > 0) {
    findings.push({
      id: "A5",
      status: "fail",
      because: "a5-untitled",
      message:
        `${untitled.length} of ${planned.rows.length} plan rows carry no wording — the record says ` +
        `an item existed without saying what the run thought it was`,
    });
  }
  if (!planned.rows.some((r) => r.status !== null)) {
    findings.push({
      id: "A5",
      status: "fail",
      because: "a5-no-status",
      message: "no plan row carries a status — the record cannot answer whether any item moved",
    });
  }
  if (findings.length === 0) {
    findings.push({ id: "A5", status: "pass", because: "a5-ok", message: planned.reason });
  }
  return findings;
}

/**
 * A6 — no assertion read an empty set. Each emptiness fails by its own name.
 *
 * Where a set is one the OTHER assertions actually iterate, its size is taken
 * from that set rather than from the account's count of it. A count computed
 * beside the array it describes can drift from it, and then A6 reports "fine"
 * about a set A1 and A2 never saw — a check reading a neighbour of the thing it
 * claims to measure. Only the sizes no assertion holds an array for
 * (`requests`, `items`, `topLevel`, `toolOutputs`) are read from `counts`.
 */
function gradeCounts(account: GradeableAccount): Finding[] {
  const required: Array<[string, number, string]> = [
    ["requests", account.counts.requests, "the workstream has no request history, so nothing below could be derived"],
    ["items", account.counts.items, "the item stream is empty — a run that completes with nothing recorded"],
    ["topLevel", account.counts.topLevel, "no item is top-level, so the run's own thread could not be read"],
    ["messages", account.said.length, "no top-level message, so A4 has nothing to place the activity against"],
    ["toolOutputs", account.counts.toolOutputs, "no top-level tool_output, so the run reported without doing anything"],
    ["fileRows", account.did.length, "the file record is empty, so A1 and A2 read an empty set"],
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
 * A7 — every cursor followed, on all three collections.
 *
 * A single-page read under-reads silently, which is the same failure as an
 * empty set: the assertion grades a fragment while reporting on the whole.
 */
function gradePaging(account: GradeableAccount, collections: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const collection of collections) {
    const report = account.reads[collection];
    if (report === undefined) {
      findings.push({
        id: "A7",
        status: "fail",
        because: "a7-never-read",
        message: `"${collection}" was never read, so its rows could not have informed any assertion`,
      });
      continue;
    }
    if (report.truncated) {
      findings.push({
        id: "A7",
        status: "fail",
        because: "a7-truncated",
        message:
          `"${collection}" still had a nextCursor after ${report.pages} page(s) — the read stopped ` +
          `short and every count derived from it is a fragment`,
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      id: "A7",
      status: "pass",
      because: "a7-ok",
      message: collections
        .map((c) => `${c}: ${account.reads[c].pages} page(s), ${account.reads[c].rows} row(s)`)
        .join(" · "),
    });
  }
  return findings;
}

/**
 * Grade an account against the expectation the run was given.
 *
 * `collections` are the three the reader was required to read, passed in rather
 * than hardcoded so A7 fails when one is missing instead of quietly grading two.
 */
export function grade(
  account: GradeableAccount,
  expectation: Expectation,
  collections: string[],
): Finding[] {
  return [
    ...gradePaths(account, expectation),
    ...gradeAgreement(account),
    ...gradeOrder(account),
    ...gradeCausality(account),
    ...gradePlan(account),
    ...gradeCounts(account),
    ...gradePaging(account, collections),
  ];
}

/** The failing findings, which are the goal's failures verbatim. */
export function failuresOf(findings: Finding[]): string[] {
  return findings
    .filter((f) => f.status === "fail")
    .map((f) => `${f.id} (${ASSERTIONS[f.id] ?? "unknown assertion"}): ${f.message}`);
}
