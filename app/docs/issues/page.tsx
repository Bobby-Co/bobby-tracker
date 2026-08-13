import { DocHeader, DocSection, Steps, Step, ComingSoon, Callout, DocPager } from "@/components/docs/doc-ui"

export default function IssuesPage() {
    return (
        <>
            <DocHeader
                eyebrow="Issue management"
                title="Working with issues"
                lead={
                    <>
                        Issues are where the intelligence layer meets your day-to-day workflow. Create
                        them, track them on a timeline, and let the knowledge graph point you at the
                        code that matters.
                    </>
                }
            />

            <DocSection id="create" title="Creating an issue">
                <p>
                    From a project, open <strong>New issue</strong> and fill in the details. Only a
                    title is required — everything else can be edited later.
                </p>
                <Steps>
                    <Step title="Give it a title">
                        A short summary of what&apos;s happening. This is the only required field.
                    </Step>
                    <Step title="Describe it (optional)">
                        Add detail in the description — Markdown is supported, so you can include code
                        blocks, lists, and links.
                    </Step>
                    <Step title="Set status, priority, and labels">
                        Choose a status and priority, and add comma-separated labels (for example{" "}
                        <code>bug, performance</code>) to organise the issue.
                    </Step>
                    <Step title="Pick the analyser effort (optional)">
                        Leave it to inherit the project default, or raise it so the analyser digs
                        deeper for a richer, more accurate analysis — slower and pricier at higher
                        effort.
                    </Step>
                    <Step title="Create the issue">
                        Save it. Once the project is indexed, the analyser can ground the issue in
                        specific files and lines from your knowledge graph.
                    </Step>
                </Steps>
            </DocSection>

            <Callout tone="ember">
                <p>
                    Grounded suggestions rely on an indexed project. If an issue can&apos;t cite code
                    yet, make sure the project&apos;s analyser is enabled and has finished indexing —
                    see the <a href="/docs/graph-analysis">graph analysis system</a>.
                </p>
            </Callout>

            <DocSection id="timeline" title="Timeline view">
                <p>
                    The timeline is a full-page, planning-oriented view of a project&apos;s issues. It
                    lays work out over time so you can see what&apos;s in flight and what&apos;s coming,
                    rather than reading a flat list.
                </p>
                <p>
                    Open it from a project to switch from the issue list into the timeline workspace.
                </p>
            </DocSection>

            <DocSection id="groups" title="Groups & collections">
                <ComingSoon>
                    How to organise issues into groups and collections across projects is coming soon.
                </ComingSoon>
            </DocSection>

            <DocSection id="sessions" title="Public sessions">
                <ComingSoon>
                    Sharing a project or issue through a public session — and collecting submissions —
                    will be documented here.
                </ComingSoon>
            </DocSection>

            <DocPager current="/docs/issues" />
        </>
    )
}
