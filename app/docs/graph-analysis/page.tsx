import { DocHeader, DocSection, ComingSoon, Callout, DocPager } from "@/components/docs/doc-ui"

export default function GraphAnalysisPage() {
    return (
        <>
            <DocHeader
                eyebrow="Graph analysis system"
                title="Overview"
                lead={
                    <>
                        The graph analysis system is Ucelot&apos;s intelligence layer. It turns your
                        repository into a knowledge graph and makes that graph useful — grounding
                        issues, answering questions, and surfacing the code that matters.
                    </>
                }
            />

            <DocSection>
                <p>
                    Once a repository is connected and processed (see{" "}
                    <a href="/docs/data-processing">how your data is processed</a>), Ucelot holds a
                    structured, queryable model of your codebase. The rest of the product builds on
                    it.
                </p>
            </DocSection>

            <DocSection id="knowledge-graph" title="The knowledge graph">
                <p>
                    The knowledge graph is a map of your code — the entities in your repository and how
                    they connect. Because it captures relationships and not just text, Ucelot can trace
                    a path through your codebase and point at specific files and lines rather than
                    guessing from a filename.
                </p>
                <p>This is what powers grounded issues: when an issue references code, it&apos;s drawing on the graph.</p>
            </DocSection>

            <Callout tone="secondary">
                <p>
                    For the high-level thinking behind the graph — the top-down, graph-plus-vectors,
                    agentic approach — see <a href="/docs/intelligence">Codebase intelligence</a>.
                </p>
            </Callout>

            <DocSection id="ask" title="Asking your codebase">
                <ComingSoon>
                    A walkthrough of querying the graph directly — asking questions in natural language
                    and reading grounded answers — is coming soon.
                </ComingSoon>
            </DocSection>

            <DocSection id="indexing" title="Indexing & refresh">
                <ComingSoon>
                    Details on how a project is indexed, when the graph refreshes, and how to trigger a
                    re-index will land here.
                </ComingSoon>
            </DocSection>

            <DocPager current="/docs/graph-analysis" />
        </>
    )
}
