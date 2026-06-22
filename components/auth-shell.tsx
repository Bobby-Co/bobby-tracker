"use client"
import PixelGradient, { DARK_EMBER_STOPS } from "@/components/pixel-gradient"
import {BrandLockup} from "@/components/BrandLockup";

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
    return (
        <div className="flex min-h-screen">
            {/* Left brand panel — desktop only. The hero pixel gradient pulled
                into a dark register, glowing from the top-left behind the mark. */}
            <aside className="relative hidden w-[51.5%] shrink-0 overflow-hidden bg-[#0b090b] lg:block">
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
            <main className="relative z-10 flex flex-1 items-center justify-center bg-white px-6 py-12 lg:-ml-8 squircle-card lg:shadow-[-24px_0_60px_-24px_rgba(0,0,0,0.45)]" suppressHydrationWarning>
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
