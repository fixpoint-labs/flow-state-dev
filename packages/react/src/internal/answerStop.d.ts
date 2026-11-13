import type { ResumeAction } from "@flow-state-dev/core/types";
import type { RequestHandle, StreamOption } from "@flow-state-dev/client";
/** The answer a screen sends: which stop, how it resolves, and its payload. */
export type StopAnswer = {
    suspensionId: string;
    action: ResumeAction;
    data?: unknown;
};
/** Answer `body` on `request`, through the call `reason` belongs to. */
export declare function answerStop(request: RequestHandle, reason: string | undefined, body: StopAnswer): Promise<RequestHandle>;
export declare function answerStop(request: RequestHandle, reason: string | undefined, body: StopAnswer, options: StreamOption): Promise<Response>;
//# sourceMappingURL=answerStop.d.ts.map