/**
 * The model-facing send tool (FIX-1230).
 *
 * Two things are worth testing here and nothing else is. The tool is a thin
 * surface over `RequestHost.sendMessage` by design — every guard lives at the
 * verb — so re-asserting the door here would be testing a pass-through.
 *
 *  1. **It reaches the verb and hands back its result unchanged**, refusals
 *     included, so a model reads the same named answer a programmatic caller
 *     does rather than a thrown tool error it can only retry blindly.
 *  2. **A short `tools.defaults.timeoutMs` with retry enabled produces EXACTLY
 *     ONE send.** This is the founding constraint of the whole feature — one
 *     message, one recipient — failing through a back door: the generic timeout
 *     rejects on its timer and does nothing to the underlying promise, so a
 *     default nobody set on purpose lets the retry start a second live send.
 *     A test on default configuration proves nothing about either.
 */
import { describe, expect, it } from "vitest";
import { relaySendTool } from "../../src/tools/relay-send-tool";
import { buildToolExecutor, type ToolExecutorConfig } from "../../src/blocks/internal/tool-executor";
import type { RequestHost, SendMessageInput, SendMessageResult } from "../../src/types/request-host";
import { createMockContext } from "../helpers";

/**
 * A request host whose send is slower than the flow default below, and which
 * counts the calls that actually reached it.
 *
 * The host is the only thing faked here: what is under test is the wrapper the
 * framework puts around a tool, not what the verb decides.
 */
function countingHost(options: { delayMs: number; result?: SendMessageResult }) {
  const calls: SendMessageInput[] = [];
  const host = {
    async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
      calls.push(input);
      await new Promise((r) => setTimeout(r, options.delayMs));
      return (
        options.result ?? { ok: true, outcome: "accepted", deliveryRequestId: "req_delivery" }
      );
    }
  } as unknown as RequestHost;
  return { host, calls };
}

/** Flow defaults short enough to fire mid-send, with retry enabled. */
const SHORT_DEFAULTS: ToolExecutorConfig["flowTools"] = {
  defaults: { timeoutMs: 20, retry: { maxAttempts: 3, baseDelayMs: 0 } }
};

function executorFor(host: RequestHost, flowTools: ToolExecutorConfig["flowTools"]) {
  const tool = relaySendTool();
  return buildToolExecutor(
    tool as never,
    {
      flowTools,
      generatorBlockName: "gen",
      itemVisibility: undefined,
      agentName: undefined,
      statusGuard: { active: 0, saved: "" }
    },
    createMockContext({ requestHost: host } as never)
  );
}

describe("relaySendTool", () => {
  it("produces EXACTLY ONE send under a short flow default with retry enabled", async () => {
    // The delivery outlasts the flow's 20ms default by 4x. Without the tool's
    // own timeout/retry the wrapper would reject at 20ms, leave the first send
    // live, and start a second — a duplicate the recipient cannot tell from a
    // second message the sender meant to send.
    const { host, calls } = countingHost({ delayMs: 80 });

    const result = await executorFor(host, SHORT_DEFAULTS)({
      to: "s_r",
      kind: "question",
      payload: { text: "ship it?" }
    });

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, outcome: "accepted" });
  });

  it("returns a refusal as a VALUE, not as a thrown tool error", async () => {
    // A model can act on `refused: "unknown-recipient"`. It can do nothing
    // useful with an exception except try the same call again.
    const { host } = countingHost({
      delayMs: 0,
      result: {
        ok: false,
        outcome: "refused",
        refused: "unknown-recipient",
        detail: "no such session"
      }
    });

    const result = await executorFor(host, undefined)({ to: "s_gone", kind: "question" });

    expect(result).toMatchObject({ ok: false, refused: "unknown-recipient" });
  });

  it("passes the caller's locator and kind through to the verb unchanged", async () => {
    const { host, calls } = countingHost({ delayMs: 0 });

    await executorFor(host, undefined)({
      to: "s_named",
      kind: "status",
      payload: { stage: "drafting" }
    });

    expect(calls[0]).toMatchObject({
      to: "s_named",
      kind: "status",
      payload: { stage: "drafting" },
      // Fire-and-forget is the tool's whole surface: a blocking send parks the
      // generator turn, which is a different contract for a model to reason
      // about.
      mode: "fireAndForget"
    });
  });

  it("admits an out-of-range timeoutMs at the schema so the VERB can name it", async () => {
    // A schema-level range check throws before the handler runs and reaches the
    // model as a parse error, while the spec promises a readable
    // `invalid-timeout`. Those cannot both hold, and the readable one wins: the
    // schema types the field as a number and admits the value.
    const tool = relaySendTool();
    const parsed = (tool.config.inputSchema as { safeParse: (v: unknown) => { success: boolean } })
      .safeParse({ to: "s", kind: "k", timeoutMs: Number.POSITIVE_INFINITY });

    expect(parsed.success).toBe(true);
  });

  it("declares its own timeout and retry rather than relying on the flow's", async () => {
    // The mechanism behind the first test, pinned separately so a change that
    // removes it fails here with a message naming what was removed rather than
    // only as a duplicate count somewhere downstream.
    const tool = relaySendTool();

    expect(tool.config.timeoutMs).toBe(0);
    expect(tool.config.retry).toMatchObject({ maxAttempts: 1 });
  });

  it("takes a name override, since a model picks a tool by its name", async () => {
    expect(relaySendTool({ name: "notifyWorker" }).name).toBe("notifyWorker");
  });
});
