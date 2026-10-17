export default function (api) {
  api.on("session_start", () => console.error("FSD_RPC_PROBE_READY"));
  api.registerCommand("fsd-probe", {
    description: "Exercise the native RPC UI round trip without a model call",
    handler: async (_args, ctx) => {
      const answer = await ctx.ui.confirm("FSD bridge probe", "Use staging?", { timeout: 30000 });
      api.appendEntry("fsd-probe-answer", { answer });
      ctx.ui.notify(`FSD_PROBE_ANSWER:${answer}`, "info");
    },
  });
  api.registerCommand("fsd-probe-history", {
    description: "Read persisted probe data without a model call",
    handler: async (_args, ctx) => {
      const entries = ctx.sessionManager.getEntries();
      const found = entries.filter((entry) => entry.type === "custom" && entry.customType === "fsd-probe-answer");
      ctx.ui.notify(`FSD_PROBE_HISTORY:${JSON.stringify(found.map((entry) => entry.data))}`, "info");
    },
  });
}
