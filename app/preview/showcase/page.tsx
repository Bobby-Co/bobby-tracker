// Dev-only preview of the landing's feature-showcase demos, on the dark
// section they actually sit on. Lets the looping mocks be checked without
// scrolling the whole landing (and its 400vh hero runway) every time. Not
// linked from anywhere; safe to delete.
//
// Sibling of /preview/timeline-playful — same idea, different surface.

import {
    DemoStyles,
    AnalysisDemo,
    DuplicatesDemo,
    TimelineDemo,
} from "@/components/ui/feature-demos"

const INK = "#1a100e" // must match the landing's INK

const ROWS = [
    {
        eyebrow: "Know your repo",
        title: "Issues that point at the code",
        demo: <AnalysisDemo />,
    },
    {
        eyebrow: "Help you manage",
        title: "Catch the duplicates before they pile up",
        demo: <DuplicatesDemo />,
    },
    {
        eyebrow: "Collaborate with your team",
        title: "Everyone sees the same plan",
        demo: <TimelineDemo />,
    },
]

export default function ShowcasePreviewPage() {
    return (
        <main
            className="min-h-screen px-8 py-16 sm:px-16"
            style={{ backgroundColor: INK }}
        >
            <DemoStyles />
            <div className="mx-auto max-w-6xl">
                <p className="mb-12 text-[11px] font-bold uppercase tracking-[0.18em] text-[#fffae8]/35">
                    Preview · landing feature demos
                </p>
                <div className="flex flex-col gap-24">
                    {ROWS.map((r) => (
                        <div key={r.eyebrow} className="grid items-center gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] lg:gap-14">
                            <div className="max-w-sm">
                                <span className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-[color:var(--c-primary)]">
                                    {r.eyebrow}
                                </span>
                                <h2 className="mt-4 text-[28px] font-extrabold leading-[1.15] tracking-[-0.025em] text-[#fffae8] sm:text-[38px]">
                                    {r.title}
                                </h2>
                            </div>
                            {r.demo}
                        </div>
                    ))}
                </div>
            </div>
        </main>
    )
}
