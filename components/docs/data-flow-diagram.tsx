// Data-processing flow: what actually happens to a connected repository.
//   connect → [ isolated clone → agent + open-source model ] → vector DB
// The two middle stages sit inside a dashed "isolated environment" boundary to
// make the single-tenant guarantee visible. Server-safe: all motion is CSS,
// scoped under .df- classes injected via a <style> tag (same pattern as the
// waitlist page). Provider is intentionally soft-referenced (see the footnote):
// today it's Fireworks.ai, but it's a swappable, privacy-compliant provider.

import type { ReactNode } from "react"

// Glyph + title + a short one-liner. The full explanation lives in the prose
// beneath the diagram, so the box copy stays to a few words and reads at a
// glance rather than competing with the paragraphs below.
function Stage({ icon, title, desc }: { icon: ReactNode; title: ReactNode; desc: string }) {
    return (
        <div className="df-stage card flex h-full flex-col items-center justify-center gap-2 px-3 py-4 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-amber-50 text-amber-700">
                {icon}
            </span>
            <span className="text-[12.5px] font-bold leading-tight tracking-[-0.01em] text-[color:var(--c-text)]">
                {title}
            </span>
            <span className="text-[11px] leading-snug text-[color:var(--c-text-muted)]">{desc}</span>
        </div>
    )
}

function Connector() {
    return (
        <div className="df-conn grid shrink-0 place-items-center">
            <svg
                className="df-arrow rotate-90 text-amber-500 lg:rotate-0"
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
            >
                <path d="M4 12h15M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </div>
    )
}

export function DataFlowDiagram() {
    return (
        <figure className="my-7 not-prose">
            <style>{DF_CSS}</style>

            <div className="df-flow flex flex-col items-stretch gap-2 lg:flex-row lg:items-stretch">
                <Stage
                    title="Connect a repository"
                    desc="No install, nothing to run"
                    icon={
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    }
                />

                <Connector />

                {/* Isolation boundary wraps the clone + analysis stages */}
                <div className="df-zone relative flex flex-1 flex-col items-stretch gap-2 rounded-[18px] border border-dashed border-amber-400/60 bg-amber-50/30 p-3 pt-5 lg:flex-row lg:pt-3">
                    <span className="df-zone-label absolute -top-2.5 left-4 inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-[color:var(--c-page)] px-2.5 py-[2px] text-[10.5px] font-bold uppercase tracking-wide text-amber-700">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
                        </svg>
                        Isolated on Ucelot infrastructure
                    </span>

                    <Stage
                        title="Sandboxed clone"
                        desc="Single-tenant, kept separate"
                        icon={
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                                <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
                                <path d="M9 9h6v6H9z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                            </svg>
                        }
                    />

                    <Connector />

                    <Stage
                        title={
                            <>
                                Examined by an agent<sup className="font-bold text-amber-700">*</sup>
                            </>
                        }
                        desc="Open-source model, no training"
                        icon={
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                                <rect x="5" y="7" width="14" height="12" rx="2.5" stroke="currentColor" strokeWidth="2" />
                                <path d="M12 3v4M9 12h.01M15 12h.01M9 16h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                        }
                    />
                </div>

                <Connector />

                <Stage
                    title="Stored as a knowledge graph"
                    desc="Provisioned vector database"
                    icon={
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" strokeWidth="2" />
                            <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" stroke="currentColor" strokeWidth="2" />
                        </svg>
                    }
                />
            </div>

            <figcaption className="mt-3.5 text-[12px] leading-5 text-[color:var(--c-text-muted)]">
                <span className="font-bold text-amber-700">*</span> Today that provider is{" "}
                <strong>Fireworks.ai</strong>, running open-weight models under a data-privacy
                agreement. The provider is not fixed — it can be swapped for another compliant host
                in the future without changing how your data is handled.
            </figcaption>
        </figure>
    )
}

const DF_CSS = `
.df-conn { min-height: 26px; min-width: 26px; }
/* Only opacity is animated so it never clobbers Tailwind's rotate transform. */
.df-arrow { animation: df-pulse 2.4s ease-in-out infinite; }
@keyframes df-pulse {
    0%, 100% { opacity: 0.35; }
    50%      { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
    .df-arrow { animation: none; opacity: 0.6; }
}
`
