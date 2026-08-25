import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repoState = vi.hoisted(() => ({
  getIncomeSummary: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/db/portfolio-db", () => ({
  getRepository: async () => repoState,
}));

import { GET } from "../app/api/portfolio/income/route";

describe("GET /api/portfolio/income", () => {
  it("scopes reads to the lab's server-side principal", async () => {
    const request = new NextRequest(
      "http://localhost/api/portfolio/income?userId=victim-user&accountId=brokerage",
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(repoState.getIncomeSummary).toHaveBeenCalledWith("devuser", {
      accountId: "brokerage",
    });
  });
});
