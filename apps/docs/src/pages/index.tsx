import { useState } from "react";
import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import CodeBlock from "@theme/CodeBlock";

import styles from "./index.module.css";

/* ── Code examples ── */

const defineExample = `import { defineFlow, generator, sequencer } from "@flow-state-dev/core";

// A tool that's a full pipeline — parallel steps, loops, error recovery
const deepResearch = sequencer({ name: "deep-research" })
  .then(parseQuery)
  .parallel({
    web: searchWeb,
    docs: searchInternalDocs,
    memory: searchMemory,
  }, { maxConcurrency: 3 })
  .then(mergeAndRank)
  .doUntil(
    (result) => result.confidence > 0.9,
    refineResults
  )
  .work(logAnalytics)
  .rescue([{ when: [SearchError], block: fallbackSearch }]);

// Sequencer that analyzes and emits a component item to the UI
const analyze = sequencer({ name: "analyze" })
  .then(gatherEvidence)
  .then(scoreFindings)
  .tap((report, ctx) => {
    ctx.emitComponent("report-card", {
      title: report.title,
      findings: report.findings,
      confidence: report.score,
    }).done();
  });

const agent = generator({
  name: "agent",
  model: "gpt-5-mini",
  prompt: "You are a research assistant.",
  history: (_input, ctx) => ctx.session.items.llm(),
  user: (input) => input.message,
  tools: [deepResearch, analyze, readDoc, writeDoc],
});

export default defineFlow({
  kind: "research-assistant",
  actions: {
    chat: { block: agent, userMessage: (i) => i.message },
  },
  session: {
    stateSchema,
    resources: { docs: docResource },
    projections: {
      docList: { client: true, compute: (ctx) => /* derived view */ },
    },
  },
})({ id: "default" });`;

const serveExample = `import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/server";
import researchFlow from "./flows/research-assistant";
import chatFlow from "./flows/chat";

const registry = createFlowRegistry();
registry.register(researchFlow);
registry.register(chatFlow);

export const { GET, POST, DELETE } = createFlowApiRouter({ registry });
// POST /api/flows/research-assistant/actions/chat
// GET  /api/flows/research-assistant/requests/:id/stream
// GET  /api/flows/sessions/:id/state`;

const renderExample = `// Register component renderers — the UI counterpart to ctx.emitComponent()
function ReportCard({ item }: { item: ComponentItem }) {
  const { title, findings, confidence } = item.data;
  return (
    <div className="report-card">
      <h3>{title}</h3>
      <ul>{findings.map(f => <li key={f}>{f}</li>)}</ul>
      <meter value={confidence} />
    </div>
  );
}

function App() {
  return (
    <FlowProvider
      config={{ baseUrl: "/api" }}
      renderers={{ component: { "report-card": ReportCard } }}
    >
      <ResearchApp />
    </FlowProvider>
  );
}

function ResearchApp() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);

  return (
    <>
      {/* ItemRenderer resolves component items to registered renderers */}
      {session.items.map(item => <ItemRenderer key={item.id} item={item} />)}

      <button
        onClick={() => session.sendAction("chat", { message: "Hello" })}
        disabled={session.isStreaming}
      >
        {session.isStreaming ? "Researching..." : "Send"}
      </button>
    </>
  );
}`;

const testExample = `const result = await testFlow({
  flow: researchFlow,
  action: "chat",
  input: { message: "Summarize the design doc" },
  userId: "testuser",
  seed: {
    session: {
      resources: {
        docs: { byId: { "design-doc": { title: "Design", content: "..." } } },
      },
    },
  },
  generators: {
    agent: mockGenerator({ script: [{ text: "The design doc covers..." }] }),
  },
});

expect(result.items).toContainItemOfType("message");
expect(result.items).toContainItemOfType("tool_call");`;

/* ── Data ── */

type CodeTab = {
  label: string;
  caption: string;
  code: string;
  language: string;
};

const codeTabs: CodeTab[] = [
  {
    label: "Define",
    caption: "Compose blocks into flows with typed state, resources, and projections.",
    code: defineExample,
    language: "ts",
  },
  {
    label: "Serve",
    caption: "Register flows and get a full REST + SSE API. No route wiring.",
    code: serveExample,
    language: "ts",
  },
  {
    label: "Render",
    caption: "Register component renderers. ItemRenderer resolves them from the stream.",
    code: renderExample,
    language: "tsx",
  },
  {
    label: "Test",
    caption: "Deterministic tests with mock generators. No LLM calls needed.",
    code: testExample,
    language: "ts",
  },
];

type FeatureItem = {
  title: string;
  description: string;
};

const features: FeatureItem[] = [
  {
    title: "Four primitives. Compose freely.",
    description:
      "Handler, generator, sequencer, router. The sequencer DSL alone gives you parallel steps, forEach, doUntil/doWhile loops, background work, branching, error recovery, and more.",
  },
  {
    title: "Flows are full APIs.",
    description:
      "Define a flow and you have REST endpoints, SSE streaming, session management, and state snapshots. No route wiring.",
  },
  {
    title: "Hybrid memory + filesystem.",
    description:
      "Resources combine rich text with structured state — like files that carry metadata. Scoped to sessions, users, or projects.",
  },
  {
    title: "Built for an ecosystem.",
    description:
      "Blocks are portable. Share a tool, a handler, or an entire flow. Community blocks compose with yours out of the box.",
  },
  {
    title: "Streaming that just works.",
    description:
      "Messages, components, status updates — all stream over SSE as blocks execute. Disconnect mid-response? Reconnect with a sequence cursor.",
  },
  {
    title: "Type-safe, end to end.",
    description:
      "One Zod schema flows from server blocks through client SDK to React hooks. No glue code. No type drift.",
  },
];

/* ── Components ── */

function Hero() {
  return (
    <header className={styles.heroBanner}>
      <div className="container">
        <Heading as="h1" className={styles.heroTitle}>
          Stop wiring. Start building.
        </Heading>
        <p className={styles.heroSubtitle}>
          <span className={styles.brandName}>flow-state.dev</span> gives you
          composable primitives for AI orchestration, streaming, state, and
          error handling — so you can explore new patterns instead of
          reinventing infrastructure.
        </p>
        <div className={styles.buttons}>
          <Link className={styles.primaryBtn} to="/docs/getting-started/quick-start">
            Get Started
          </Link>
          <Link className={styles.secondaryBtn} to="/docs/intro">
            Why flow-state.dev?
          </Link>
        </div>
      </div>
    </header>
  );
}

function Features() {
  return (
    <section className={styles.features}>
      <div className={styles.featureGrid}>
        {features.map((f, i) => (
          <div key={i} className={styles.featureCard}>
            <div className={styles.featureTitle}>{f.title}</div>
            <p className={styles.featureDesc}>{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CodeShowcase() {
  const [active, setActive] = useState(0);
  const tab = codeTabs[active];

  return (
    <section className={styles.codeShowcase}>
      <Heading as="h2" className={styles.sectionTitle}>
        From definition to UI in four steps
      </Heading>
      <p className={styles.sectionSubtext}>
        Define blocks. Register flows. Wire up React. Write deterministic tests. Each layer is independent and composable.
      </p>

      <div className={styles.tabBar}>
        {codeTabs.map((t, i) => (
          <button
            key={i}
            className={`${styles.tab} ${i === active ? styles.tabActive : ""}`}
            onClick={() => setActive(i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.codeWrapper}>
        <CodeBlock language={tab.language}>{tab.code}</CodeBlock>
      </div>
      <p className={styles.codeCaption}>{tab.caption}</p>
    </section>
  );
}

function CTA() {
  return (
    <section className={styles.ctaSection}>
      <Heading as="h2" className={styles.ctaTitle}>
        Ready to explore?
      </Heading>
      <p className={styles.ctaSubtext}>
        Get a streaming AI app running in minutes. Then push it somewhere no framework has gone before.
      </p>
      <div className={styles.buttons}>
        <Link className={styles.primaryBtn} to="/docs/getting-started/quick-start">
          Quick Start
        </Link>
        <Link className={styles.secondaryBtn} to="/blog/welcome">
          Read the Manifesto
        </Link>
      </div>
    </section>
  );
}

/* ── Page ── */

export default function Home(): React.ReactElement {
  return (
    <Layout
      title="AI workflows, composed"
      description="flow-state.dev — a TypeScript framework for building AI workflows with composable blocks, resumable streaming, scoped state, and full-stack type safety."
    >
      <Hero />
      <main>
        <Features />
        <CodeShowcase />
        <CTA />
      </main>
    </Layout>
  );
}
