import { useState } from "react";
import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import CodeBlock from "@theme/CodeBlock";
import Tabs from "@theme/Tabs";
import TabItem from "@theme/TabItem";

import styles from "./index.module.css";

/* ── Code examples ── */

const composabilityExample = `// Deterministic scaffold — non-deterministic step in a controlled slot

const research = sequencer({ name: "research" })
  .then(parseQuery)
  .parallel({
    web:  searchWeb,
    news: searchNews,      // fan out — deterministic orchestration
  })
  .then(rankResults)
  .then(synthesize)        // generator — non-deterministic step
  .work(logAnalytics);     // async background work — never blocks the pipeline`;

const remixabilityExample = `import { memory } from "thought-fabric";

// Option A — use a full Thought Fabric strategy as-is
const agent = sequencer({ name: "agent" })
  .then(generateResponse)
  .work(memory.system());  // entire memory pipeline, async

// ─────────────────────────────────────────────────────────────

// Option B — pull out individual blocks, compose your own way
import { captureMemory, reflectOnMemory, injectMemory }
  from "thought-fabric";

// inline sub-sequencer — composability all the way down
const customMemory = sequencer({ name: "custom-memory" })
  .then(captureMemory)
  .then(myOwnProcessingStep)  // your block, in the middle
  .then(reflectOnMemory);

const agent = sequencer({ name: "agent" })
  .then(injectMemory)
  .then(generateResponse)
  .work(customMemory);      // run async — never blocks the pipeline`;

const stateExample = `// State flows through every block — scoped to exactly the right level

const write = sequencer({ name: "write" })
  .then(generator, {
    prompt: "You are a writing assistant.",
    context: (input, ctx) => ({
      // User scope — persists across all sessions
      preferences: ctx.user.state.tonePreferences,
      // Resource — a file-like object the LLM reads and writes directly
      draft:       ctx.session.resources.draft.read(),
    }),
  })
  .then(handler, {
    // Deterministic step — update structured state from generator output
    run: async (output, ctx) => {
      await ctx.session.resources.draft.setState({
        wordCount:  output.content.split(" ").length,
        // Session scope — this conversation only
        milestone:  ctx.session.state.currentMilestone,
      });
    },
  });`;

/* ── Data ── */

type PrimitiveType = {
  name: string;
  description: string;
  color: string;
  dashed?: boolean;
};

const primitives: PrimitiveType[] = [
  { name: "generator", description: "LLM interaction · streaming output", color: "#8B5CF6" },
  { name: "sequencer", description: "orchestration · loops · parallel steps", color: "#3B82F6" },
  { name: "handler", description: "deterministic compute · tools", color: "#10B981" },
  { name: "router", description: "branching · conditional dispatch", color: "#F59E0B" },
  { name: "state · resources", description: "memory substrate · session · user · project", color: "#475569", dashed: true },
];

type SequencerMethod = {
  method: string;
  description: string;
};

const sequencerMethods: SequencerMethod[] = [
  { method: ".then()", description: "Sequential steps — chain any block after any other, with full type safety from input to output." },
  { method: ".parallel()", description: "Fan out to multiple blocks simultaneously with configurable concurrency. Results merge back into a single typed payload." },
  { method: ".work()", description: "Background workers that run async alongside the main pipeline — fire-and-forget or waited on explicitly — without blocking the response stream." },
  { method: ".doUntil() · .doWhile()", description: "Iterative loops with configurable exit conditions. Run a block until a quality threshold is met, a state condition changes, or a limit is hit." },
  { method: ".rescue()", description: "Per-step error recovery — catch specific error types and route to a fallback block, without unwinding the whole flow." },
  { method: "sub-sequencers", description: "Sequencers compose inside sequencers — to any depth. Every nested flow is a reusable block, passable to .then() or .work()." },
];

type BatteryItem = {
  title: string;
  description: string;
};

const batteries: BatteryItem[] = [
  { title: "DevTools", description: "Full visibility into every block execution, stream item, and state change across the entire flow chain. Debug what's actually happening — not what you think is happening." },
  { title: "Testing & Evals", description: "Built-in unit test harness for individual blocks and full flows, plus an eval framework for scoring outputs against datasets. Test deterministically. Evaluate non-deterministically. Ship confidently." },
  { title: "Pattern Library", description: "A curated set of common block compositions — ready to drop in, extend, or use as a starting point. Not black boxes. Every pattern is built from the same primitives you use yourself." },
  { title: "Client SDK & React", description: "A typed client SDK and React hooks that connect your frontend directly to your flows — streaming, session state, and client data projections included. Full-stack best practices, built in." },
  { title: "CLI & Scaffolding", description: "Scaffold new blocks and flows from the command line. Spin up the dev server, run evals, inspect outputs — all from fsdev." },
  { title: "Model Flexibility", description: "Provider-agnostic by design. Swap models per block, define semantic model groups, and get automatic retry and fallback — without changing your flow logic." },
];

type ThoughtFabricDomain = {
  title: string;
  description: string;
  shipped: boolean;
};

const thoughtFabricDomains: ThoughtFabricDomain[] = [
  { title: "Memory", description: "Working, episodic, and semantic memory (short-term context, long-term recall, compressed knowledge)", shipped: true },
  { title: "Attention", description: "Salience scoring and relevance filtering", shipped: true },
  { title: "Reasoning", description: "Structured thought and planning", shipped: true },
  { title: "Identity", description: "Persistent agent persona and self-model", shipped: false },
  { title: "Perception", description: "Multimodal input processing and grounding", shipped: false },
  { title: "Metacognition", description: "Self-monitoring and adaptive behavior", shipped: false },
];

const storageBackends = ["In-memory", "Filesystem", "SQLite · PostgreSQL", "MongoDB"];

/* ── Components ── */

function InstallSnippet() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText("npx create-flow-state-app my-app");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button className={styles.installSnippet} onClick={handleCopy} type="button">
      <span className={styles.installPrompt}>$</span>
      npx create-flow-state-app my-app
      <span className={styles.installCopy}>{copied ? "copied!" : "click to copy"}</span>
    </button>
  );
}

/* Section 1 — Hero */
function Hero() {
  return (
    <header className={styles.heroBanner}>
      <div className={styles.heroGrid} />
      <div className={`container ${styles.heroContent}`}>
        <span className={styles.eyebrowBadge}>TypeScript · Composable · Remixable</span>
        <Heading as="h1" className={styles.heroTitle}>
          Unlock your agentic flow.
        </Heading>
        <p className={styles.heroSubtitle}>
          Composable primitives and proven strategies built to be remixed, extended, or replaced.
          So you can build the system you actually need — instead of inheriting someone else's guesses.
        </p>
        <div className={styles.buttons}>
          <Link className={styles.primaryBtn} to="/docs/getting-started/quick-start">
            Start composing
          </Link>
          <Link className={styles.secondaryBtn} to="/docs/intro">
            Read the docs
          </Link>
        </div>
        <InstallSnippet />
      </div>
    </header>
  );
}

/* Section 2 — The Shift */
function TheShift() {
  return (
    <section className={styles.section}>
      <div className="container">
        <span className={styles.sectionLabel}>// the shift</span>
        <Heading as="h2" className={styles.sectionTitle}>
          What if you never felt locked into a specific way of doing things?
        </Heading>
        <p className={styles.sectionBody}>
          Flow-state.dev gives you composable primitives and best-practice implementations ready to
          use immediately. But every implementation is built from the same building blocks you have
          direct access to — which means nothing is a black box, and everything can be taken apart,
          understood, and rebuilt your way.
        </p>
        <blockquote className={styles.pullQuote}>
          Solid foundations to start from. No constraints on where you take them.
        </blockquote>
      </div>
    </section>
  );
}

/* Section 3 — Primitives + Flow Diagram */
function Primitives() {
  return (
    <section className={styles.sectionAlt}>
      <div className="container">
        <span className={styles.sectionLabel}>// primitives</span>
        <Heading as="h2" className={styles.sectionTitle}>
          Building blocks that compose into anything.
        </Heading>
        <p className={styles.sectionBody}>
          The framework is built around two ideas: <strong>Flow</strong> — a set of block primitives
          that compose into pipelines of deterministic and non-deterministic processing — and{" "}
          <strong>State</strong> — a normalized layer of typed data scopes and file-like resources
          that give your flows memory and continuity. Together, they give you everything you need to
          build any agentic system you can imagine.
        </p>

        <div className={styles.primitivesGrid}>
          {primitives.map((p) => (
            <div
              key={p.name}
              className={styles.primitiveCard}
              style={{
                borderLeftColor: p.color,
                borderLeftStyle: p.dashed ? "dashed" : "solid",
              }}
            >
              <code className={styles.primitiveName}>{p.name}</code>
              <span className={styles.primitiveDesc}>{p.description}</span>
            </div>
          ))}
        </div>

        {/* CSS flow diagram */}
        <div className={styles.flowDiagram}>
          <div className={styles.flowNode} data-kind="sequencer">sequencer &quot;research&quot;</div>
          <div className={styles.flowArrow}>↓ .parallel()</div>
          <div className={styles.flowParallel}>
            <div className={styles.flowNode} data-kind="handler">handler &quot;search-web&quot;</div>
            <div className={styles.flowNode} data-kind="handler">handler &quot;search-news&quot;</div>
          </div>
          <div className={styles.flowArrow}>↓ .then()</div>
          <div className={styles.flowNode} data-kind="handler">handler &quot;rank-results&quot;</div>
          <div className={styles.flowArrow}>↓ .then()</div>
          <div className={styles.flowMainWithWork}>
            <div className={styles.flowNode} data-kind="generator">generator &quot;synthesize&quot;</div>
            <div className={styles.flowWorkBranch}>
              <span className={styles.flowWorkArrow}>← ←</span>
              <div className={styles.flowWorkNode}>.work(logAnalytics)</div>
              <span className={styles.flowWorkLabel}>background · async</span>
            </div>
          </div>

          <div className={styles.flowDashedSeparator} />

          <div className={styles.flowStateSection}>
            <code className={styles.flowStateLabel}>ctx.session.resources</code>
            <div className={styles.flowNode} data-kind="state">state &quot;research-notes&quot;</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Section 4 — Code Examples (Tabs) */
function CodeExamples() {
  return (
    <section className={styles.section}>
      <div className="container">
        <span className={styles.sectionLabel}>// see it in practice</span>
        <p className={styles.sectionIntro}>
          The same primitives. Three different things you can do with them.
        </p>

        <div className={styles.codeTabsWrapper}>
          <Tabs>
            <TabItem value="composability" label="Composability">
              <CodeBlock language="typescript">{composabilityExample}</CodeBlock>
            </TabItem>
            <TabItem value="remixability" label="Remixability">
              <CodeBlock language="typescript">{remixabilityExample}</CodeBlock>
            </TabItem>
            <TabItem value="state" label="State">
              <CodeBlock language="typescript">{stateExample}</CodeBlock>
            </TabItem>
          </Tabs>
        </div>

        <p className={styles.codeFootnote}>
          * pseudo-code — exact APIs finalized in implementation spec
        </p>
      </div>
    </section>
  );
}

/* Section 5 — State & Resources */
function StateAndResources() {
  return (
    <section className={styles.sectionAlt}>
      <div className="container">
        <span className={styles.sectionLabel}>// state &amp; resources</span>
        <Heading as="h2" className={styles.sectionTitle}>
          State your agents can actually think with.
        </Heading>
        <p className={styles.sectionBody}>
          Flow-state.dev treats state as a first-class primitive — not an afterthought. Everything
          your agent knows, remembers, and acts on lives in a structured, cloud-native substrate
          built to scale with production systems.
        </p>

        <div className={styles.threeCardGrid}>
          <div className={styles.infoCard}>
            <h3 className={styles.infoCardTitle}>Scoped by context</h3>
            <p className={styles.infoCardDesc}>
              State scoped to a session, user, or project — exactly the right level, automatically.
            </p>
          </div>
          <div className={styles.infoCard}>
            <h3 className={styles.infoCardTitle}>Text and data, unified</h3>
            <p className={styles.infoCardDesc}>
              Resources carry both a structured data layer and a text layer your agent reads and
              writes directly. Both managed atomically.
            </p>
          </div>
          <div className={styles.infoCard}>
            <h3 className={styles.infoCardTitle}>Cloud-native by default</h3>
            <p className={styles.infoCardDesc}>
              All the ergonomics of a local filesystem — read, write, file-like resources — without
              being tied to one. State that persists and scales across your entire system.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Section 6 — Composable, Not Chaotic */
function ComposableNotChaotic() {
  return (
    <section className={styles.section}>
      <div className="container">
        <span className={styles.sectionLabel}>// structure</span>
        <Heading as="h2" className={styles.sectionTitle}>
          Composable, not chaotic.
        </Heading>
        <p className={styles.sectionBody}>
          No prescribed implementation doesn't mean no structure. Flow-state.dev's primitives
          naturally produce consistent, readable, maintainable agent code — not because the framework
          enforces conventions, but because well-designed building blocks are self-structuring by
          nature.
        </p>
        <blockquote className={styles.pullQuote}>
          Think MVC: a clear mental model for organizing responsibility, without stopping you from
          building whatever you need.
        </blockquote>
        <p className={styles.sectionNote}>
          Every flow you write will look like it was designed — because it was.
        </p>
      </div>
    </section>
  );
}

/* Section 7 — Flows / Sequencer Depth */
function SequencerDepth() {
  return (
    <section className={styles.sectionAlt}>
      <div className="container">
        <span className={styles.sectionLabel}>// sequencer</span>
        <Heading as="h2" className={styles.sectionTitle}>
          More expressive than a DAG. Easier to use than one.
        </Heading>
        <p className={styles.sectionBody}>
          The sequencer is the orchestration primitive at the heart of every flow. It composes blocks
          into arbitrarily complex pipelines — with the power of a directed graph and none of the
          overhead of defining one explicitly.
        </p>

        <div className={styles.methodGrid}>
          {sequencerMethods.map((m) => (
            <div key={m.method} className={styles.methodCell}>
              <code className={styles.methodName}>{m.method}</code>
              <p className={styles.methodDesc}>{m.description}</p>
            </div>
          ))}
        </div>

        <div className={styles.durableCard}>
          <div className={styles.durableCardContent}>
            <h3 className={styles.durableCardTitle}>Durable by design.</h3>
            <p className={styles.durableCardDesc}>
              Every block execution emits a persisted event. Flows survive restarts, reconnects, and
              failures — with a full execution trace you can inspect in DevTools. Pause and resume
              support is on the roadmap.
            </p>
          </div>
          <div className={styles.storageChips}>
            {storageBackends.map((b) => (
              <span key={b} className={styles.storageChip}>{b}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* Section 8 — Batteries Included */
function BatteriesIncluded() {
  return (
    <section className={styles.section}>
      <div className="container">
        <span className={styles.sectionLabel}>// batteries included</span>
        <Heading as="h2" className={styles.sectionTitle}>
          Everything a production agent needs. Nothing you have to build yourself.
        </Heading>
        <p className={styles.sectionBody}>
          The primitives are the foundation. The framework ships everything else you need to build,
          test, debug, and ship production-grade agentic systems — all composable, all optional.
        </p>

        <div className={styles.batteriesGrid}>
          {batteries.map((b) => (
            <div key={b.title} className={styles.batteryCard}>
              <h3 className={styles.batteryTitle}>{b.title}</h3>
              <p className={styles.batteryDesc}>{b.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Section 9 — Thought Fabric */
function ThoughtFabric() {
  return (
    <section className={styles.sectionAlt}>
      <div className="container">
        <span className={styles.sectionLabel}>// Thought Fabric</span>
        <span className={styles.thoughtFabricBadge}>Thought Fabric</span>
        <Heading as="h2" className={styles.sectionTitle}>
          An optional cognitive layer — built entirely on flow-state.dev primitives.
        </Heading>
        <p className={styles.sectionBody}>
          Thought Fabric is a growing library of cognitive building blocks for your agents. Each one
          is a composable block — not a black box. Use what fits, swap what doesn't, or reach inside
          any of them and rebuild from scratch.
        </p>

        <div className={styles.domainGrid}>
          {thoughtFabricDomains.map((d) => (
            <div
              key={d.title}
              className={`${styles.domainCard} ${!d.shipped ? styles.domainCardComing : ""}`}
            >
              {!d.shipped && <span className={styles.comingLabel}>coming</span>}
              <h3 className={styles.domainTitle}>{d.title}</h3>
              <p className={styles.domainDesc}>{d.description}</p>
            </div>
          ))}
        </div>

        <p className={styles.sectionClose}>
          Thought Fabric isn't a feature of the framework — it's proof of what the framework makes
          possible. A full cognitive architecture, built as composable blocks, by the same team that
          built the primitives.
        </p>
      </div>
    </section>
  );
}

/* Section 10 — CTA */
function FinalCTA() {
  return (
    <section className={styles.ctaSection}>
      <div className={styles.ctaContent}>
        <Heading as="h2" className={styles.ctaTitle}>
          Build something nobody's built yet.
        </Heading>
        <p className={styles.ctaSubtext}>
          The primitives are ready. The strategies are yours to discover.
        </p>
        <div className={styles.buttons}>
          <Link className={styles.primaryBtn} to="/docs/getting-started/quick-start">
            Unlock your flow state →
          </Link>
          <Link className={styles.secondaryBtn} to="/docs/intro">
            Read the docs
          </Link>
        </div>
        <InstallSnippet />
      </div>
    </section>
  );
}

/* ── Page ── */

export default function Home(): React.ReactElement {
  return (
    <Layout
      title="Unlock your agentic flow"
      description="flow-state.dev — composable primitives and proven strategies for building agentic systems in TypeScript. Remixable, extensible, replaceable."
    >
      <Hero />
      <main>
        <TheShift />
        <Primitives />
        <CodeExamples />
        <StateAndResources />
        <ComposableNotChaotic />
        <SequencerDepth />
        <BatteriesIncluded />
        <ThoughtFabric />
        <FinalCTA />
      </main>
    </Layout>
  );
}
