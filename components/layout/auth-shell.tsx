"use client"
import PixelGradient, { DARK_EMBER_STOPS } from "@/components/ui/pixel-gradient"
import {BrandLockup} from "@/components/layout/brand-lockup";

// The split-panel auth chrome shared by /login and /onboarding: a dark brand
// panel on the left (the hero pixel gradient in a dark register) and a white
// content panel on the right that overlaps with a rounded edge. Children fill
// the right panel; the left panel and the mobile brand lockup are constant, so
// moving between sign-in and onboarding feels like one continuous surface.
export function AuthShell({
    children,
    headline = "Issues that point straight to the code.",
    subtext = "A smart issue tracker for your projects — every issue arrives with the files and lines worth investigating.",
    contentClassName = "max-w-[360px]",
}: {
    children: React.ReactNode
    headline?: string
    subtext?: string
    contentClassName?: string
}) {
    // Two separate reasons this shell is sized and clipped the way it is:
    //
    // svh, not vh — on iOS `100vh` is the LARGE viewport (the height the page
    // would have with Safari's toolbars hidden), so with the toolbar showing the
    // shell is taller than what's on screen. Nothing here scrolls, so the
    // surplus sat below the fold as a band of the panel's white. `100svh` is the
    // SMALL viewport, the height really on screen. On desktop the two match.
    //
    // overflow-clip — on Safari/Firefox the squircle polyfill redraws the card
    // as an SVG ::before and INFLATES it by the box-shadow's blur so the shadow
    // fits inside. main's `lg:shadow-[...60px...]` put that layer at top:-60px /
    // bottom:-60px, hanging 60px past the shell and making the document
    // scrollable — the same white band, but on desktop. Chrome draws no such
    // layer (native corner-shape), which is why it only showed in Safari.
    return (
        <div className="flex min-h-svh overflow-clip">
            {/* Left brand panel — desktop only. The hero pixel gradient pulled
                into a dark register, glowing from the top-left behind the mark. */}
            <aside className="relative hidden w-[51.5%] shrink-0 overflow-hidden bg-[var(--c-secondary-deep)] lg:block">
                <PixelGradient
                    stops={DARK_EMBER_STOPS}
                    variant="linear"
                    tiltDeg={45}
                    tilePx={46}
                    tileAspect={1}
                />
                {/* Bottom vignette so the headline reads cleanly over the tiles */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />

                <div className="relative z-10 flex h-full flex-col justify-between p-12">
                    <BrandLockup tone="dark" text={"inverted"} />
                    <div>
                        <h2
                            className="max-w-sm text-[30px] font-extrabold leading-[1.15] tracking-[-0.025em] text-white"
                            style={{ textShadow: "0 2px 30px rgba(0,0,0,0.45)" }}
                        >
                            {headline}
                        </h2>
                        <p
                            className="mt-4 max-w-sm text-[14px] leading-6 text-white/70"
                            style={{ textShadow: "0 1px 20px rgba(0,0,0,0.5)" }}
                        >
                            {subtext}
                        </p>
                    </div>
                </div>
            </aside>

            {/* Right content panel — on desktop it overlaps the dark panel with a
                rounded left edge, so the gradient curves out from behind it. */}
            <main className="relative z-10 flex flex-1 items-center justify-center bg-[color:var(--c-surface)] px-6 py-12 lg:-ml-8 squircle-card lg:shadow-[-24px_0_60px_-24px_rgba(0,0,0,0.45)]" suppressHydrationWarning>
                <div className={`anim-rise w-full ${contentClassName}`}>
                    {/* Brand shows here on mobile, where the left panel is hidden */}
                    <div className="mb-10 lg:hidden">
                        <BrandLockup tone="dark" />
                    </div>
                    {children}
                </div>
            </main>
        </div>
    )
}
