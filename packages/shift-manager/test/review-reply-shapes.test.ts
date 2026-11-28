/**
 * The harness manager's reply poster shapes and workforce's poster meet here,
 * at the host, and nowhere else: harness-manager's root never imports
 * workforce, so each side writes the draft, the scope and the outcome out by
 * hand (`ReplyDraft` / `ReviewReplyPoster` there, `ReviewReplyDraft` /
 * `ReviewReplies` here).
 *
 * Why it matters: `post` is a method, so TypeScript checks its parameters
 * bivariantly, and the host's `replies: github.reviewReplies` alone would let
 * a field added to one side's draft or scope through until a run posted. Each
 * shape is pinned equal both ways, so a field added, dropped or retyped on
 * either side fails `pnpm typecheck` for this package.
 */
import { describe, expectTypeOf, it } from "vitest";
import type { ReplyDraft, ReviewReplyPoster } from "@flow-state-dev/harness-manager";
import type { ReviewReplies, ReviewReplyDraft, ReviewReplyOutcome, ReviewReplyPullRequest, ReviewReplyTask } from "@flow-state-dev/workforce";

type PosterScope = Parameters<ReviewReplyPoster["post"]>[2];
type PosterOutcome = Awaited<ReturnType<ReviewReplyPoster["post"]>>[number];

describe("the reply poster's shapes, on both sides of the host", () => {
  it("are the same draft, scope and outcome, and workforce's poster is the manager's", () => {
    expectTypeOf<ReplyDraft>().toEqualTypeOf<ReviewReplyDraft>();
    expectTypeOf<PosterScope["pullRequests"][number]>().toEqualTypeOf<ReviewReplyPullRequest>();
    expectTypeOf<NonNullable<PosterScope["task"]>>().toEqualTypeOf<ReviewReplyTask>();
    expectTypeOf<PosterOutcome>().toEqualTypeOf<ReviewReplyOutcome>();
    expectTypeOf<Parameters<ReviewReplies["post"]>[2]>().toEqualTypeOf<PosterScope>();
    expectTypeOf<ReviewReplies>().toMatchTypeOf<ReviewReplyPoster>();
  });
});
