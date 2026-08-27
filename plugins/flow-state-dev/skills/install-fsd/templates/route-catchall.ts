// fsd:generated
import { createNextHandler } from "@flow-state-dev/next";
import flowstate from "{{CONFIG_IMPORT}}";

export const { GET, POST, PATCH, DELETE } = createNextHandler(flowstate);
export const dynamic = "force-dynamic";
