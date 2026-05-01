import type { ZodTypeAny } from "zod";
import type { BlockContext } from "../block";
import type {
  FlowDefinition,
  InferFlowBlockContext,
  InferFlowStateMap
} from "../flow";

type SchemaOf<T> = ZodTypeAny & { _output: T };

type DemoFlowDefinition = FlowDefinition & {
  request: { stateSchema: SchemaOf<{ requestCount: number }> };
  session: { stateSchema: SchemaOf<{ mode: "plan" | "edit" }> };
  user: { stateSchema: SchemaOf<{ role: "admin" | "member" }> };
  org: { stateSchema: SchemaOf<{ orgId: string }> };
};

type DemoStateMap = InferFlowStateMap<DemoFlowDefinition>;
const requestStateValue: DemoStateMap["request"] = { requestCount: 1 };
const sessionStateValue: DemoStateMap["session"] = { mode: "plan" };
const userStateValue: DemoStateMap["user"] = { role: "admin" };
const orgStateValue: DemoStateMap["org"] = { orgId: "proj_1" };

type DemoCtx = InferFlowBlockContext<DemoFlowDefinition>;
declare const inferredCtx: DemoCtx;
const explicitCtx: BlockContext<
  { requestCount: number },
  { mode: "plan" | "edit" },
  { role: "admin" | "member" },
  { orgId: string }
> = inferredCtx;

void requestStateValue;
void sessionStateValue;
void userStateValue;
void orgStateValue;
void explicitCtx;
export const flowStateInferenceTypeSmoke = true;
