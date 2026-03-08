import { describe, expect, it } from "vitest";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import { rlmPipeline } from "../src/rlm";

const testContext = [
  "# Technical Design Document: Widget Service",
  "",
  "## 1. Overview",
  "The Widget Service manages CRUD operations for widgets in our platform.",
  "It handles 50,000 requests per second at peak load.",
  "",
  "## 2. Architecture",
  "The service uses a microservice architecture with three components:",
  "- API Gateway: handles authentication and rate limiting",
  "- Widget Engine: core business logic for widget operations",
  "- Storage Layer: PostgreSQL for persistence, Redis for caching",
  "",
  "## 3. API Endpoints",
  "POST /widgets - Create a new widget (requires admin role)",
  "GET /widgets/:id - Retrieve a widget by ID",
  "PUT /widgets/:id - Update a widget (requires owner or admin role)",
  "DELETE /widgets/:id - Soft-delete a widget (requires admin role)",
  "",
  "## 4. Data Model",
  "Widget { id: UUID, name: string, type: enum(A,B,C), owner: UUID, created: timestamp }",
  "",
  "## 5. Performance Requirements",
  "- P99 latency: <100ms for reads, <500ms for writes",
  "- Availability: 99.95% uptime SLA",
  "- Throughput: 50K RPS sustained, 100K RPS burst",
  "",
  "## 6. Security",
  "All endpoints require JWT authentication. Admin endpoints require the 'admin' role.",
  "Widget owners can update their own widgets. Rate limiting is enforced per-user.",
].join("\n");

const emptyContext = { text: "", metadata: {} };

const rootMock = mockGenerator({
  name: "rlm-root",
  script: [{
    structuredOutput: {
      answer: "The Widget Service handles 50K RPS at peak and requires P99 latency under 100ms for reads.",
      reasoning: "Found performance requirements in section 5 of the design document via peek and grep tools.",
      sourcesUsed: ["Section 5: Performance Requirements", "Section 1: Overview"]
    }
  }]
});

const subQueryMock = mockGenerator({
  name: "rlm-sub-query",
  script: [{
    structuredOutput: {
      answer: "The service handles 50,000 requests per second at peak load.",
      confidence: 0.95,
      evidence: ["It handles 50,000 requests per second at peak load."]
    }
  }]
});

describe("rlm pipeline", () => {
  it("completes a query through the pipeline", async () => {
    rootMock.reset();
    subQueryMock.reset();

    const result = await testBlock(rlmPipeline, {
      input: {
        query: "What are the performance requirements?",
        context: testContext,
        model: "test-model"
      },
      session: {
        resources: { context: emptyContext }
      },
      generators: {
        "rlm-root": rootMock,
        "rlm-sub-query": subQueryMock
      }
    });

    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
    const output = result.output as { answer: string; reasoning: string; sourcesUsed: string[] };
    expect(output.answer).toContain("50K RPS");
    expect(output.reasoning).toBeDefined();
    expect(output.sourcesUsed).toBeInstanceOf(Array);
  });

  it("stores context in session resource before generator runs", async () => {
    rootMock.reset();

    const result = await testBlock(rlmPipeline, {
      input: {
        query: "What is this about?",
        context: "A short test context.",
        model: "test-model"
      },
      session: {
        resources: { context: emptyContext }
      },
      generators: {
        "rlm-root": rootMock,
        "rlm-sub-query": subQueryMock
      }
    });

    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("emits block_output items from the pipeline", async () => {
    rootMock.reset();
    subQueryMock.reset();

    const result = await testBlock(rlmPipeline, {
      input: {
        query: "Describe the architecture",
        context: testContext,
        model: "test-model"
      },
      session: {
        resources: { context: emptyContext }
      },
      generators: {
        "rlm-root": rootMock,
        "rlm-sub-query": subQueryMock
      }
    });

    const blockOutputs = result.items.filter((item) => item.type === "block_output");
    expect(blockOutputs.length).toBeGreaterThan(0);
  });
});
