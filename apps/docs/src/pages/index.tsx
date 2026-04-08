import { useState } from "react";
import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import CodeBlock from "@theme/CodeBlock";

import styles from "./index.module.css";

/* ── Code example ── */

const researchBlockExample = `const researchBlock = sequencer({ name: "research" })
  .then(parseQuery)
  .parallel({
    web:  searchWeb,
    docs: searchDocs,
    past: recall,            // reads ctx.user.resources.pastFindings and locates relevant items
  })
  .then(synthesize)          // generator — reads ctx.session.state.query and parallel output
  .work(handler, {
    name: "save-draft",
    sessionResources: { draft: draftResource },
    sessionStateSchema: z.object({ lastResearched: z.string() }),
    execute: async (input, ctx) => {
      await ctx.session.resources.draft.setContent(input.response)
      await ctx.session.state.patch({ lastResearched: input.query })
    },
  })
  .work(updateMemory)        // runs async, never blocks, can continue on after main thread completes

export default defineFlow({
  kind: "research",
  actions: {
    research: {
      inputSchema: z.object({ query: z.string() }),
      block: researchBlock,
      userMessage: (i) => i.query,
    },
  }
})`;

/* ── Data ── */

type BlockPrimitive = { name: string; kind: string; color: string; prop: string };

const blockPrimitives: BlockPrimitive[] = [
  {
    name: "Generator",
    kind: "LLM Calls",
    color: "#8B5CF6",
    prop: "Streams tokens, runs tool loops, and injects whatever context you provide. The AI in your pipeline — composable like everything else.",
  },
  {
    name: "Handler",
    kind: "Deterministic Functions",
    color: "#10B981",
    prop: "Pure logic with typed contracts. Validate, transform, update state. The clean boundary between AI and code — explicit by design.",
  },
  {
    name: "Sequencer",
    kind: "Orchestration",
    color: "#3B82F6",
    prop: "Chains any block after any other. Sequential, parallel, looping, background workers. Compose the architecture you actually need.",
  },
  {
    name: "Router",
    kind: "Block Selection",
    color: "#F59E0B",
    prop: "Evaluates conditions at runtime and dispatches to the right pipeline. Intent routing, mode switching, conditional flows.",
  },
];

type SystemConcept = { label: string; prop: string };

const systemConcepts: SystemConcept[] = [
  {
    label: "Flows",
    prop: "Wrap your blocks in a flow definition and get a complete API — action endpoints, SSE streaming, session management, state snapshots. No route wiring.",
  },
  {
    label: "State & Scopes",
    prop: "Request, session, user, project. Four isolation levels with atomic operations. Each block declares only the fields it touches. State that accumulates and evolves as shared memory space.",
  },
  {
    label: "Resources",
    prop: "Content body + structured metadata, in one atomic container — scoped like state. A draft, a plan, a code file. Cloud-native storage, ready for AI.",
  },
];

type Pillar = { num: string; label: string; body: string };

const pillars: Pillar[] = [
  {
    num: "01",
    label: "Composable primitives",
    body: "Four block types — generator, sequencer, handler, router — compose into any agentic architecture, paired with a typed state and resource system that gives your flows programmatic data persistence and continuity. No hidden layers. No opinions baked into the internals. Just building blocks, all the way down.",
  },
  {
    num: "02",
    label: "Proven strategies",
    body: "A growing library of production-ready implementations, each built from the same blocks and state system you work with directly. Remixable, decomposable, and never opaque. Use them as-is or as a starting point for something new.",
  },
  {
    num: "03",
    label: "Production-ready",
    body: "DevTools, testing and evals, a typed client SDK, React hooks and components, CLI scaffolding, and provider-agnostic model flexibility. A complete stack — composable at every layer.",
  },
];

type PatternItem = { label: string; href?: string };
type PatternCategory = { name: string; items: PatternItem[] };

const patternCategories: PatternCategory[] = [
  {
    name: "Multi-agent coordination patterns",
    items: [
      { label: "Supervisor", href: "/docs/patterns/supervisor" },
      { label: "Coordinator", href: "/docs/patterns/coordinator" },
      { label: "Chain of Agents" },
      { label: "Blackboard" },
      { label: "Debate" },
      { label: "Round Robin" },
    ],
  },
  {
    name: "Reasoning & planning patterns",
    items: [
      { label: "Plan and Execute", href: "/docs/patterns/plan-and-execute" },
      { label: "Self-Ask" },
      { label: "Self-Consistency" },
      { label: "Skeleton of Thought" },
      { label: "Least-to-Most" },
      { label: "Step-Back Prompting" },
    ],
  },
  {
    name: "Memory & retrieval patterns",
    items: [
      { label: "RAPTOR" },
      { label: "Mind-Map Memory" },
      { label: "Context Folding" },
      { label: "RLM" },
      { label: "Self-querying" },
      { label: "Episodic Replay" },
    ],
  },
  {
    name: "Inference-time scaling patterns",
    items: [
      { label: "RSA" },
      { label: "Tree of Thoughts" },
      { label: "Mixture of Agents" },
      { label: "Best-of-N" },
      { label: "Sequential Revision" },
    ],
  },
  {
    name: "Reactive patterns",
    items: [
      { label: "Observer" },
      { label: "Reflector" },
      { label: "Self-Healing Loop" },
      { label: "Response Auditor" },
      { label: "Citation Verifier" },
    ],
  },
  {
    name: "Human-in-the-loop patterns",
    items: [
      { label: "Approval Gates" },
      { label: "Tool Call Approval" },
      { label: "Human Feedback" },
      { label: "Collaborative Editing" },
      { label: "Preference Elicitation" },
    ],
  },
];

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
          The TypeScript agent framework where every layer is composable, nothing is a black box, and
          every implementation is yours to remix.
        </p>
        <div className={styles.buttons}>
          <Link className={styles.primaryBtn} to="/docs/getting-started/quick-start">
            Start composing →
          </Link>
          <Link className={styles.secondaryBtn} to="/docs/intro">
            Why flow-state.dev?
          </Link>
        </div>
        <InstallSnippet />
      </div>
    </header>
  );
}

/* Section 2 — Three Pillars */
function ThreePillars() {
  return (
    <section className={styles.sectionAlt}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          Everything you need. Nothing you can&apos;t see inside.
        </Heading>

        <div className={styles.pillarsGrid}>
          {pillars.map((p) => (
            <div key={p.num} className={styles.pillarCard}>
              <span className={styles.pillarNum}>{p.num}</span>
              <span className={styles.pillarLabel}>{p.label}</span>
              <p className={styles.pillarBody}>{p.body}</p>
            </div>
          ))}
        </div>

        <p className={styles.pillarsCta}>
          <Link className={styles.inlineLink} to="/docs/intro">
            Why does this matter? →
          </Link>
        </p>
      </div>
    </section>
  );
}

/* Section 3 — Proof of Life */
function PrimitivesBreakdown() {
  return (
    <div className={styles.breakdown}>
      <div className={styles.breakdownBlocksGrid}>
        {blockPrimitives.map((b) => (
          <div
            key={b.name}
            className={styles.breakdownBlock}
            style={{ "--block-color": b.color } as React.CSSProperties}
          >
            <span className={styles.breakdownBlockKind}>{b.kind}</span>
            <code className={styles.breakdownBlockName}>{b.name}</code>
            <p className={styles.breakdownBlockProp}>{b.prop}</p>
          </div>
        ))}
      </div>
      <div className={styles.breakdownConceptsGrid}>
        {systemConcepts.map((c) => (
          <div key={c.label} className={styles.breakdownConcept}>
            <span className={styles.breakdownConceptLabel}>{c.label}</span>
            <p className={styles.breakdownConceptProp}>{c.prop}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProofOfLife() {
  return (
    <section className={styles.section}>
      <div className="container">
        <span className={styles.sectionLabel}>// built from blocks and state</span>
        <Heading as="h2" className={styles.sectionTitle}>
          Built from blocks and state — all the way down.
        </Heading>
        <p className={styles.sectionBody}>
          A research pipeline: three parallel searches, a synthesis generator that reads from session
          state, and a background worker that writes the result to a resource — without ever blocking
          the stream.
        </p>

        <div className={styles.proofCode}>
          <CodeBlock language="typescript">{researchBlockExample}</CodeBlock>
        </div>

        <blockquote className={styles.pullQuote}>
          Blocks define what your flow does. State defines what it knows and remembers. Together,
          they&apos;re the substrate every strategy is built from.
        </blockquote>

        <PrimitivesBreakdown />

        <div className={styles.proofCta}>
          <Link className={styles.secondaryBtn} to="/docs/getting-started/quick-start">
            Read the docs →
          </Link>
        </div>
      </div>
    </section>
  );
}

/* Section 4 — Strategies & Ecosystem */
function StrategiesAndEcosystem() {
  return (
    <section className={styles.sectionAlt}>
      <div className="container">
        <span className={styles.sectionLabel}>// patterns</span>
        <Heading as="h2" className={styles.sectionTitle}>
          Patterns for every kind of agentic system.
        </Heading>
        <p className={styles.sectionBody}>
          Every pattern in the library is built from the same blocks and state system you just saw
          — which means every pattern is also something you can take apart, understand, and rebuild
          your way. This is how agentic techniques get discovered.
        </p>

        <div className={styles.strategyGrid}>
          {patternCategories.map((cat) => (
            <div key={cat.name} className={styles.strategyCategory}>
              <h3 className={styles.categoryName}>{cat.name}</h3>
              <div className={styles.categoryItems}>
                <span className={styles.categoryList}>
                  {cat.items.map((item, i) => (
                    <span key={item.label}>
                      {i > 0 && " · "}
                      {item.href ? (
                        <Link to={item.href} className={styles.patternLink}>{item.label}</Link>
                      ) : (
                        item.label
                      )}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.thoughtFabricBlock}>
          <div className={styles.tfHeader}>
            <span className={styles.tfName}>Thought Fabric</span>
            <span className={styles.tfAlpha}>Alpha</span>
          </div>
          <p className={styles.tfBody}>
            A full cognitive architecture — memory, attention, reasoning, identity, metacognition, and learning — built entirely from
            flow-state.dev blocks. Acts as an optional additional layer that can be added to any flow. Proof of what the primitives make
            possible.
          </p>
          <Link className={styles.inlineLink} to="/thought-fabric/introduction">
            Learn about Thought Fabric →
          </Link>
        </div>

        <p className={styles.ecosystemNote}>
          More patterns are added regularly — by us and by the community. The primitives are
          everything you need to build and share your own.
        </p>

        <div className={styles.strategyCta}>
          <Link className={styles.secondaryBtn} to="/docs/patterns/overview">
            Browse the pattern library →
          </Link>
        </div>
      </div>
    </section>
  );
}

/* Section 5 — Production Stack */
type ProductionCard = { title: string; desc: string };

const productionCards: ProductionCard[] = [
  {
    title: "DevTools",
    desc: "Full visibility into every block execution, stream item, and state change across the entire flow chain. Debug what's actually happening — not what you think is happening.",
  },
  {
    title: "Testing & Evals",
    desc: "A unit test harness for individual blocks and full flows, plus an eval framework for scoring outputs against datasets. Test deterministically. Evaluate non-deterministically.",
  },
  {
    title: "CLI & Scaffolding",
    desc: "fsdev for scaffolding new blocks and flows, running the dev server, executing evals, and inspecting outputs — all from the terminal.",
  },
  {
    title: "Client SDK & React",
    desc: "Typed client SDK and React hooks connecting your frontend to your flows — streaming, session state, and client-side data projections included.",
  },
  {
    title: "Model Flexibility",
    desc: "Provider-agnostic. Swap models per block, define semantic model groups, automatic retry and fallback — without changing your flow logic.",
  },
  {
    title: "React Component Library",
    desc: "Pre-built React components for streaming output, tool call display, chat UI, plan display, and more — wired directly to the client SDK and ready to drop in.",
  },
];

function ProductionStack() {
  return (
    <section className={styles.section}>
      <div className="container">
        <span className={styles.sectionLabel}>// production stack</span>
        <Heading as="h2" className={styles.sectionTitle}>
          A complete production stack. Every layer composable.
        </Heading>
        <p className={styles.sectionBody}>
          Building production agentic systems requires more than a good architecture. It requires
          the tooling to run it, observe it, test it, and ship it. flow-state.dev includes all of
          it — and because the framework is composable at its core, none of the tooling is a black
          box either.
        </p>

        <div className={styles.productionGrid}>
          {productionCards.map((card) => (
            <div key={card.title} className={styles.productionCard}>
              <h3 className={styles.productionCardTitle}>{card.title}</h3>
              <p className={styles.productionCardDesc}>{card.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Section 6 — Final CTA */
function FinalCTA() {
  return (
    <section className={styles.ctaSection}>
      <div className={styles.ctaContent}>
        <Heading as="h2" className={styles.ctaTitle}>
          Build something nobody&apos;s built yet.
        </Heading>
        <p className={styles.ctaSubtext}>
          Everything you need to build a production-ready agentic system. 
        </p>
        <div className={styles.buttons}>
          <Link className={styles.primaryBtn} to="/docs/getting-started/quick-start">
            Unlock your flow state →
          </Link>
        </div>
        <InstallSnippet />
        <p className={styles.ctaSupportingLine}>
          TypeScript · Vercel AI SDK · Works with any model provider
        </p>
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
        <ThreePillars />
        <ProofOfLife />
        <StrategiesAndEcosystem />
        <ProductionStack />
        <FinalCTA />
      </main>
    </Layout>
  );
}
