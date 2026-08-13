import { DocHeader, DocSection, Callout, DocPager } from "@/components/docs/doc-ui"

const PILLARS = [
    {
        title: "Top-down",
        body: "We start from the whole repository and work downward — from the overall structure to modules, files, and finally the individual lines. The big picture comes first, so detail always has context.",
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 3v18M12 3l-4 4M12 3l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
        ),
    },
    {
        title: "Graph",
        body: "The structure of your codebase is captured as a graph — the entities in your code and the relationships between them. This is what lets Ucelot follow how one part of the system reaches another.",
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="6" cy="6" r="2.2" stroke="currentColor" strokeWidth="2" />
                <circle cx="18" cy="7" r="2.2" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="18" r="2.2" stroke="currentColor" strokeWidth="2" />
                <path d="M7.7 7.4l3 8.4M16.5 8.7l-3.3 7M8.1 6.5h7.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
        ),
    },
    {
        title: "Vectors",
        body: "On top of the structure we layer semantic vector embeddings, so the system can reason about meaning — finding related code by what it does, not just by matching names.",
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M4 12h4l2-6 4 12 2-6h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        ),
    },
    {
        title: "Agentic",
        body: "An agentic system traverses the graph and the vectors to investigate a question — gathering the relevant pieces and grounding its answer in specific files and lines.",
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect x="5" y="7" width="14" height="12" rx="2.5" stroke="currentColor" strokeWidth="2" />
                <path d="M12 3v4M9 12h.01M15 12h.01M9 16h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
        ),
    },
]

export default function IntelligencePage() {
    return (
        <>
            <DocHeader
                eyebrow="Concepts"
                title="Codebase intelligence"
                lead={
                    <>
                        Everything Ucelot does well starts with one thing: it reads your repository
                        into a form it can reason over. Here&apos;s the shape of how that works — the
                        approach, not the recipe.
                    </>
                }
            />

            <DocSection>
                <p>
                    Ucelot builds a working model of your codebase using a <strong>top-down</strong>{" "}
                    approach that combines a <strong>graph</strong> of your code&apos;s structure,{" "}
                    <strong>vector</strong> embeddings for meaning, and an <strong>agentic</strong>{" "}
                    system that reasons over both. Together they let Ucelot answer questions about
                    your code and tie every issue back to the exact place it belongs.
                </p>
            </DocSection>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {PILLARS.map((p) => (
                    <div key={p.title} className="card h-full">
                        <div className="mb-2.5 grid h-9 w-9 place-items-center rounded-[10px] bg-amber-50 text-amber-700">
                            {p.icon}
                        </div>
                        <div className="text-[15px] font-bold tracking-[-0.01em]">{p.title}</div>
                        <p className="mt-1.5 text-[13px] leading-6 text-[color:var(--c-text-muted)]">
                            {p.body}
                        </p>
                    </div>
                ))}
            </div>

            <DocSection title="How the pieces fit">
                <p>
                    The graph gives structure, the vectors give meaning, and the agents do the
                    reasoning. A question doesn&apos;t get answered by a single lookup — the system
                    moves through the map of your codebase the way an engineer would: start broad,
                    narrow in, and land on the specific code that matters.
                </p>
            </DocSection>

            <Callout tone="info" title="A deliberate outline">
                <p>
                    This page describes the <em>approach</em> at a high level on purpose. The exact way
                    Ucelot constructs and traverses this model is part of what makes it work — but the
                    mental model above is all you need to use the product well.
                </p>
            </Callout>

            <DocSection>
                <p>
                    Curious what happens to your code while all of this runs? The{" "}
                    <a href="/docs/data-processing">data processing</a> page walks through the full
                    path — cloning, analysis, and storage — and the isolation guarantees at each step.
                </p>
            </DocSection>

            <DocPager current="/docs/intelligence" />
        </>
    )
}
