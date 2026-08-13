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
};

type DemoStateMap = InferFlowStateMap<DemoFlowDefinition>;
const requestStateValue: DemoStateMap["request"] = { requestCount: 1 };
const sessionStateValue: DemoStateMap["session"] = { mode: "plan" };
const userStateValue: DemoStateMap["user"] = { role: "admin" };

type DemoCtx = InferFlowBlockContext<DemoFlowDefinition>;
declare const inferredCtx: DemoCtx;
const explicitCtx: BlockContext<
  { requestCount: number },
  { mode: "plan" | "edit" },
  { role: "admin" | "member" }
> = inferredCtx;

void requestStateValue;
void sessionStateValue;
void userStateValue;
void explicitCtx;
export const flowStateInferenceTypeSmoke = true;
