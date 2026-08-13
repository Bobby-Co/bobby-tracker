import { DocHeader, DocSection, Callout, DocPager } from "@/components/docs/doc-ui"
import { DataFlowDiagram } from "@/components/docs/data-flow-diagram"

export default function DataProcessingPage() {
    return (
        <>
            <DocHeader
                eyebrow="Privacy & security"
                title="How your data is processed"
                lead={
                    <>
                        When you connect a repository, your code takes a short, well-defined path
                        through our platform. This page lays it out end to end — where your code goes,
                        who examines it, and where the results are stored.
                    </>
                }
            />

            <DataFlowDiagram />

            <DocSection title="Step by step">
                <p>
                    <strong>1. You connect a repository.</strong> There&apos;s no installation and no
                    agent to run on your own infrastructure — you simply grant access to a Git
                    repository.
                </p>
                <p>
                    <strong>2. Your repo is cloned into an isolated workspace.</strong> The code is
                    pulled into a sandboxed, single-tenant environment on our platform, kept separate
                    from every other customer&apos;s code.
                </p>
                <p>
                    <strong>3. An agent examines the code.</strong> Inside that isolated environment,
                    an agent reads your codebase using an <strong>open-source model</strong> hosted on
                    a data-privacy-compliant inference provider.<sup>*</sup> Your code is used to
                    build <em>your</em> knowledge graph — never to train models.
                </p>
                <p>
                    <strong>4. The knowledge graph is stored.</strong> The resulting graph and vector
                    embeddings are written to a vector database provisioned for your workspace, ready
                    for Ucelot to query.
                </p>
            </DocSection>

            <Callout tone="ember" title="On the inference provider">
                <p>
                    <span className="font-bold">*</span> Today, the open-source model runs on{" "}
                    <strong>Fireworks.ai</strong> under a data-privacy agreement. The provider is not
                    fixed to Fireworks.ai — it can be swapped for another compliant host in the future
                    without changing how your data is handled or where your graph is stored.
                </p>
            </Callout>

            <DocSection title="What this means for you">
                <ul>
                    <li>
                        <strong>Isolation.</strong> Your repository is processed in a single-tenant
                        workspace — it is not mixed with other customers&apos; code.
                    </li>
                    <li>
                        <strong>Open-source models.</strong> Analysis runs on open-source models, not a
                        black box, hosted with a privacy-compliant provider.
                    </li>
                    <li>
                        <strong>No training on your code.</strong> Your code is used to build your own
                        knowledge graph, not to train third-party models.
                    </li>
                    <li>
                        <strong>Nothing to install.</strong> No local agent, daemon, or build step runs
                        on your machines.
                    </li>
                </ul>
            </DocSection>

            <DocPager current="/docs/data-processing" />
        </>
    )
}
