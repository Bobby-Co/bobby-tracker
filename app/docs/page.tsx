import { DocHeader, DocSection, FeatureCard, Callout, DocPager } from "@/components/docs/doc-ui"

export default function DocsOverviewPage() {
    return (
        <>
            <DocHeader
                eyebrow="Introduction"
                title="What is Ucelot?"
                lead={
                    <>
                        Ucelot is a smart issue tracker that actually understands your codebase. Every
                        issue comes grounded in your real code — the specific files and lines worth
                        investigating — because behind the tracker sits a live map of how your
                        repository fits together.
                    </>
                }
            />

            <DocSection>
                <p>
                    Most trackers treat an issue as a title and a description floating on their own.
                    Ucelot connects each issue back to the code it&apos;s about. When you open an issue,
                    it can point you straight at the files, symbols, and lines that matter — so triage
                    starts with context instead of a blank page.
                </p>
                <p>Ucelot is built from two halves that work together:</p>
            </DocSection>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <FeatureCard
                    title="Graph analysis system"
                    href="/docs/graph-analysis"
                    icon={
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <circle cx="6" cy="6" r="2.4" stroke="currentColor" strokeWidth="2" />
                            <circle cx="18" cy="7" r="2.4" stroke="currentColor" strokeWidth="2" />
                            <circle cx="12" cy="18" r="2.4" stroke="currentColor" strokeWidth="2" />
                            <path d="M7.7 7.5l3 8M16.6 8.8l-3.4 7M8 6.6h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    }
                >
                    The intelligence layer. It reads your repository into a knowledge graph and lets
                    you ask questions and ground issues in real code.
                </FeatureCard>
                <FeatureCard
                    title="Issue management"
                    href="/docs/issues"
                    icon={
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
                            <path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    }
                >
                    The workflow layer. Create issues, follow them on a timeline, and organise work —
                    all wired to the intelligence underneath.
                </FeatureCard>
            </div>

            <Callout tone="ember" title="No installation">
                <p>
                    There is nothing to install and no agent to run on your own machines. You connect a
                    repository and Ucelot does the rest on our platform. See{" "}
                    <a href="/docs/data-processing">How your data is processed</a> for exactly what
                    happens to your code.
                </p>
            </Callout>

            <DocSection title="Where to go next">
                <ul>
                    <li>
                        <a href="/docs/intelligence">Codebase intelligence</a> — a high-level look at how
                        Ucelot understands a repository.
                    </li>
                    <li>
                        <a href="/docs/data-processing">How your data is processed</a> — the privacy and
                        isolation model, start to finish.
                    </li>
                    <li>
                        <a href="/docs/graph-analysis">Graph analysis system</a> — the knowledge graph
                        and what you can do with it.
                    </li>
                    <li>
                        <a href="/docs/issues">Issue management</a> — creating issues and the timeline
                        view.
                    </li>
                </ul>
            </DocSection>

            <DocPager current="/docs" />
        </>
    )
}
