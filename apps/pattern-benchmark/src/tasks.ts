/**
 * The cross-pattern benchmark task suite.
 *
 * A fixed, categorized set of goal->answer tasks. Every subject (pattern +
 * baseline) is run against the same tasks with the same model, so the only
 * independent variable is the coordination shape. Each task carries a LOCKED
 * rubric — the atomic criteria the blinded LLM judge scores the output against.
 * The rubric is published here on purpose: the methodology is only defensible if
 * the grading criteria are auditable.
 *
 * Categories are chosen to separate coordination shapes:
 * - reasoning: multi-constraint logic where a single pass tends to drop a
 *   constraint; review/iteration patterns should recover it.
 * - multi-step-research: synthesis that benefits from decomposition + merge.
 * - critique-revision: a flawed input to improve; auditor/debate/review shapes
 *   should out-perform a one-shot answer.
 * - tool-use: tasks that reward explicit step decomposition and sequencing
 *   (planning), even without external tools wired in.
 */
import type { BenchmarkTask } from "@flow-state-dev/core";

export const tasks: BenchmarkTask[] = [
  // -------------------------------------------------------------------------
  // reasoning
  // -------------------------------------------------------------------------
  {
    id: "reason-scheduling",
    category: "reasoning",
    prompt:
      "Three teammates — Ada, Ben, and Cleo — must each take exactly one of " +
      "three on-call shifts (Mon, Wed, Fri). Ada can't do Friday. Ben refuses " +
      "to work the same day as any shift adjacent to Cleo's. Cleo takes Monday. " +
      "Assign each person a shift and justify why it's the only valid assignment.",
    rubric: [
      "Assigns each of the three people exactly one distinct shift",
      "The assignment respects every stated constraint",
      "Explains why the assignment is uniquely forced, not just asserts it",
    ],
  },
  {
    id: "reason-unit-budget",
    category: "reasoning",
    prompt:
      "A team has a $10,000 budget. They spend 35% on tooling, then 40% of the " +
      "remainder on contractors, then a flat $1,200 on travel. How much is left, " +
      "and what fraction of the original budget does the remainder represent? " +
      "Show each step.",
    rubric: [
      "Computes each intermediate value correctly (tooling, remainder, contractors, travel)",
      "Arrives at the correct final remaining amount and its fraction of the original budget",
      "Shows the arithmetic steps rather than only the final number",
    ],
  },
  {
    id: "reason-tradeoff",
    category: "reasoning",
    prompt:
      "A startup must choose between shipping a feature in 2 weeks with known " +
      "tech debt, or 6 weeks clean. Give a recommendation that explicitly weighs " +
      "at least three competing factors and states the condition under which the " +
      "opposite choice would be correct.",
    rubric: [
      "Makes a clear recommendation",
      "Weighs at least three distinct, relevant factors",
      "States a concrete condition under which the opposite choice would win",
    ],
  },

  // -------------------------------------------------------------------------
  // multi-step-research
  // -------------------------------------------------------------------------
  {
    id: "research-migration",
    category: "multi-step-research",
    prompt:
      "Produce a migration plan for moving a monolithic REST API to event-driven " +
      "services. Cover, as distinct sections: data consistency, rollout sequencing, " +
      "and observability. Each section must contain a concrete recommendation, not " +
      "general advice.",
    rubric: [
      "Includes all three required sections (data consistency, rollout sequencing, observability)",
      "Each section gives a concrete, specific recommendation rather than generic advice",
      "The sections form a coherent overall plan rather than disconnected notes",
    ],
  },
  {
    id: "research-comparison",
    category: "multi-step-research",
    prompt:
      "Compare optimistic vs pessimistic concurrency control for a high-write " +
      "ledger. Address correctness, throughput under contention, and operational " +
      "complexity, then give a single recommendation for the ledger use case.",
    rubric: [
      "Addresses all three dimensions (correctness, throughput under contention, operational complexity)",
      "Characterizes both approaches accurately on each dimension",
      "Ends with a single, justified recommendation for the stated use case",
    ],
  },
  {
    id: "research-synthesis",
    category: "multi-step-research",
    prompt:
      "Synthesize a one-page onboarding guide for a new backend engineer joining " +
      "a team that uses TypeScript, Postgres, and a message queue. Organize it so a " +
      "reader can act on it in their first week.",
    rubric: [
      "Covers the three named technologies (TypeScript, Postgres, message queue)",
      "Is organized into an actionable first-week structure",
      "Is concrete enough to act on rather than a list of platitudes",
    ],
  },

  // -------------------------------------------------------------------------
  // critique-revision
  // -------------------------------------------------------------------------
  {
    id: "critique-error-handling",
    category: "critique-revision",
    prompt:
      "Improve this function description so it is correct and complete: " +
      "'getUser(id) returns the user. If not found it returns the user anyway.' " +
      "Point out what is wrong, then give a corrected, precise specification.",
    rubric: [
      "Identifies the contradiction/error in the original description",
      "Provides a corrected specification that resolves the not-found behavior precisely",
      "The revision is unambiguous about inputs, outputs, and the error/edge case",
    ],
  },
  {
    id: "critique-argument",
    category: "critique-revision",
    prompt:
      "Critique and then strengthen this argument: 'We should rewrite the app in " +
      "Rust because Rust is fast.' Identify the weak reasoning, then produce a " +
      "more rigorous version of the argument (or a rebuttal) with explicit criteria.",
    rubric: [
      "Identifies the specific weakness in the original reasoning (e.g. unstated assumptions, missing tradeoffs)",
      "Produces a more rigorous argument or rebuttal grounded in explicit criteria",
      "The result is more defensible than the original, not just longer",
    ],
  },
  {
    id: "critique-spec-gap",
    category: "critique-revision",
    prompt:
      "Here is a feature spec: 'Add a search box that filters the list.' List the " +
      "ambiguities and missing requirements a developer would need resolved, then " +
      "rewrite it into an implementable spec.",
    rubric: [
      "Surfaces multiple concrete ambiguities/missing requirements",
      "Rewrites the spec so it is implementable without further clarification",
      "The rewrite preserves the original intent",
    ],
  },

  // -------------------------------------------------------------------------
  // tool-use (planning / explicit step decomposition)
  // -------------------------------------------------------------------------
  {
    id: "plan-incident",
    category: "tool-use",
    prompt:
      "A production database is at 95% disk and climbing. Produce an ordered, " +
      "step-by-step incident response plan that a single on-call engineer can " +
      "follow, distinguishing immediate mitigation from follow-up remediation.",
    rubric: [
      "Provides an explicitly ordered sequence of steps",
      "Separates immediate mitigation from longer-term remediation",
      "The steps are concrete and executable by one engineer",
    ],
  },
  {
    id: "plan-release",
    category: "tool-use",
    prompt:
      "Lay out a release checklist for shipping a breaking API change to external " +
      "customers. Decompose it into pre-release, release, and post-release phases, " +
      "with at least two concrete actions per phase.",
    rubric: [
      "Decomposes the work into the three named phases (pre-release, release, post-release)",
      "Each phase has at least two concrete, relevant actions",
      "The checklist specifically addresses the breaking-change/customer-communication risk",
    ],
  },
  {
    id: "plan-data-pipeline",
    category: "tool-use",
    prompt:
      "Design the steps to build a nightly data pipeline that ingests CSVs, " +
      "validates them, loads them into a warehouse, and alerts on failure. Present " +
      "the steps in execution order and note where each step can fail.",
    rubric: [
      "Lists the pipeline steps in correct execution order (ingest, validate, load, alert)",
      "Notes a realistic failure mode for each step",
      "The design is coherent and implementable as a nightly job",
    ],
  },
];
