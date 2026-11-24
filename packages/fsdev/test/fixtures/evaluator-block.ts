import { boolean, choice, evaluator } from "@flow-state-dev/core";
import { mockEvaluationModel } from "@flow-state-dev/testing";
import { z } from "zod";

const triage = evaluator({
  name: "triage-evaluator",
  model: mockEvaluationModel({
    answers: {
      team: { type: "choice", choice: "billing", confidence: 0.9 },
      urgent: { type: "boolean", probability: 0.3 },
    },
  }),
  inputSchema: z.object({ message: z.string() }),
  state: (input) => input.message,
  questions: {
    team: choice("Which team?", { billing: "Payments", technical: "Bugs" }),
    urgent: boolean("Urgent?"),
  },
});

export default triage;
