import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { Plan, PlanTask } from "./schemas";

type ClientDataContext = {
  state: Record<string, unknown>;
  resources: Record<string, unknown>;
};

/**
 * clientData helper: returns a summary list of all plans in the collection.
 * Use in defineFlow({ session: { clientData: { plans: planListClientData } } })
 */
export function planListClientData(ctx: ClientDataContext) {
  const plans = ctx.resources.plans as unknown as ResourceCollectionRef<Plan>;
  if (plans === undefined) return [];

  return plans.list().map((ref) => ({
    planId: ref.name.replace("plans/", ""),
    goal: ref.state.goal,
    status: ref.state.status,
    completedSteps: ref.state.tasks.filter(
      (s: PlanTask) => s.status === "completed"
    ).length,
    totalSteps: ref.state.tasks.length,
    iteration: ref.state.iteration,
  }));
}

/**
 * clientData helper factory: returns detail for a specific plan.
 * Use in defineFlow({ session: { clientData: { activePlan: planDetailClientData("main") } } })
 */
export function planDetailClientData(planId: string) {
  return (ctx: ClientDataContext) => {
    const plans = ctx.resources.plans as unknown as ResourceCollectionRef<Plan>;
    if (plans === undefined) return null;

    const planRef = plans.getOptional({ planId });
    if (planRef === undefined) return null;

    return {
      goal: planRef.state.goal,
      status: planRef.state.status,
      tasks: planRef.state.tasks.map((s: PlanTask) => ({
        id: s.id,
        goal: s.goal,
        status: s.status,
        result: s.result,
        error: s.error,
      })),
      iteration: planRef.state.iteration,
      maxIterations: planRef.state.maxIterations,
    };
  };
}
