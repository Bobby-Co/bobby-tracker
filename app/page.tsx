import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import type { Viewport } from "next"
import { Supabase } from "@/lib/server/supabase"
import { BetaAccess } from "@/lib/shared/BetaAccess"
import { EMBER_STOPS, type Stop } from "@/components/ui/pixel-gradient"
import HeroField from "@/components/ui/hero-field"
import HeroDissolve from "@/components/ui/hero-dissolve"
import PixelEdge from "@/components/ui/pixel-edge"
import Reveal from "@/components/ui/reveal"
import { DemoStyles, AnalysisDemo, DuplicatesDemo, TimelineDemo } from "@/components/ui/feature-demos"
import NewsletterForm from "@/components/ui/newsletter-form"

// The hero dissolves into this, and the manifesto section is painted in it, so
// the ripple lands on a real destination rather than just draining to pale.
// Warm near-black — it's the "near-black warm" stop of DARK_EMBER_STOPS, so the
// tone already belongs to the ember ramp rather than being a new colour.
const INK = "#1a100e"

// DARK_EMBER_STOPS, retuned to bottom out at INK. That palette's final stop is
// #0b090b (the login panel colour) — darker than this section — so reusing it
// unchanged would ring the hero in a halo darker than its own background. Same
// ramp otherwise, so the field still reads as the product's dark ember.
const HERO_DARK_STOPS: Stop[] = [
    { pos: 0.0, c: [255, 188, 86] }, // glowing warm gold core (at the corner)
    { pos: 0.08, c: [238, 142, 46] }, // amber-orange
    { pos: 0.18, c: [178, 90, 28] }, // burnt amber
    { pos: 0.3, c: [104, 52, 22] }, // ember-brown
    { pos: 0.5, c: [54, 28, 18] }, // dark warm
    { pos: 1.0, c: [26, 16, 14] }, // = INK, so the glow resolves into the page
]

// How far the hero lockup has inverted, 0→1, driven off `--hero-s`. Deliberately
// completes well before the field finishes darkening: mapping it straight to
// `--hero-s` meant the copy only reached full white at the very END of the
// runway, so it read as permanently half-grey the whole way down.
const INVERT = "clamp(0, calc(var(--hero-s, 0) / 0.26), 1)"

const BobbyMark = () => (
  <svg viewBox="0 0 106 102" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        fill="currentColor"
        d="M 95.59375 67.023438 L 95.609375 17.179688 C 95.610001 12.229996 91.550003 8.239998 86.589996 8.339996 C 81.720001 8.43 77.919998 12.610001 77.919998 17.470001 L 77.921875 32.132813 C 77.919998 36.360001 74.559998 39.91 70.330002 39.950001 L 68.539063 39.84375 C 64.690002 39.32 61.84 35.979996 61.84 32.089996 L 61.84375 18.078125 C 61.84 14.139999 59.560001 10.470001 55.919998 8.959999 C 52.259998 7.440002 49.66 9.010002 47.189999 10.520004 C 44.529999 12.129997 36.509998 16.379997 36.509998 16.379997 L 36.03125 16.640625 L 35.546875 16.382813 C 35.549999 16.379997 27.440001 12.099998 25.32 10.770004 C 22.82 9.199997 20.280001 7.440002 16.540001 8.870003 C 12.78 10.309998 10.39 14.050003 10.39 18.089996 L 10.390625 67.023438 C 10.84 79.970001 21.459999 90.339996 34.509998 90.339996 L 71.492188 90.34375 C 84.540001 90.339996 95.160004 79.970001 95.59375 67.023438 Z M 23.25 40.460938 C 21.219999 39.689999 19.780001 37.729996 19.780001 35.419998 C 19.780001 33.110001 21.219999 31.150002 23.25 30.370003 C 23.860001 30.129997 24.52 30 25.200001 30 C 26.26 30 27.24 30.309998 28.08 30.839996 C 29.6 31.800003 30.610001 33.490005 30.610001 35.419998 C 30.610001 37.349998 29.6 39.049999 28.08 40 C 27.24 40.529999 26.26 40.830002 25.200001 40.830002 C 24.52 40.830002 23.860001 40.700001 23.25 40.460938 Z M 44.15625 39.609375 C 42.939999 38.619999 42.169998 37.110001 42.169998 35.419998 C 42.169998 33.729996 42.939999 32.220001 44.16 31.229996 C 45.09 30.459999 46.279999 30 47.580002 30 C 49.07 30 50.41 30.599998 51.389999 31.57 C 52.389999 32.559998 53 33.919998 53 35.419998 C 53 36.93 52.389999 38.279999 51.389999 39.259998 C 50.41 40.240002 49.07 40.830002 47.580002 40.830002 C 46.279999 40.830002 45.09 40.369999 44.15625 39.609375 Z M 34.507813 81.492188 C 26.360001 81.489998 19.68 75.07 19.26 67.019997 L 29.6875 67.023438 L 29.6875 60.148438 C 29.690001 58.169998 31.290001 56.57 33.27 56.57 L 42.1875 56.570313 C 44.169998 56.57 45.77 58.169998 45.77 60.150002 L 45.773438 67.023438 L 58.632813 67.023438 L 58.632813 60.148438 C 58.630001 58.169998 60.23 56.57 62.209999 56.57 L 71.132813 56.570313 C 73.110001 56.57 74.709999 58.169998 74.709999 60.150002 L 74.710938 67.023438 L 86.742188 67.023438 C 86.32 75.07 79.639999 81.489998 71.489998 81.489998 Z"
      />
  </svg>
)

// ─── shared bits ────────────────────────────────────────────────────────────
const SECTION_X = "px-8 sm:px-16 lg:px-24"

function Eyebrow({ children }: { children: ReactNode }) {
    return (
        <span className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-[color:var(--c-accent)]">
            {children}
        </span>
    )
}

function GlyphTile({ children }: { children: ReactNode }) {
    return (
        <span className="grid size-11 place-items-center rounded-sq bg-[color:var(--c-primary-tint)] text-[color:var(--c-accent)]">
            {children}
        </span>
    )
}

function FooterCol({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div>
            <h3 className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-[#1a100e]/45">
                {title}
            </h3>
            <ul className="mt-3 flex flex-col gap-2.5">{children}</ul>
        </div>
    )
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <li>
            <Link href={href} className="text-[13.5px] font-semibold text-[#1a100e]/70 hover:text-[#1a100e]">
                {children}
            </Link>
        </li>
    )
}

// ─── icons ──────────────────────────────────────────────────────────────────
// Only what the "How it works" steps use — the feature grid and the two-system
// cards that needed the rest are gone.
const I = {
    link: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    ),
    shield: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
    ),
    check: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
            <path d="M8.5 12l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    ),
}

// The showcase on the dark section: one row per capability, copy on the left and
// a looping mock of the real thing on the right. Ordered as the product is
// actually used — understand the repo, work the backlog, then plan together.
const SHOWCASE: {
    eyebrow: string
    title: React.ReactNode
    body: string
    demo: React.ReactNode
}[] = [
    {
        eyebrow: "Know your repo",
        title: (
            <>
                Issues that point at <span className="text-[color:var(--c-primary)]">the code</span>
            </>
        ),
        body: "Ucelot reads your repository into a knowledge graph, so an issue arrives already carrying the files and lines worth investigating — not just a title and a hunch.",
        demo: <AnalysisDemo />,
    },
    {
        eyebrow: "Help you manage",
        title: (
            <>
                Catch the <span className="text-[color:var(--c-primary)]">duplicates</span> before
                they pile up
            </>
        ),
        body: "It recognises when a new report is one you already have and links the two, so the backlog stays something you can actually read instead of four versions of the same bug.",
        demo: <DuplicatesDemo />,
    },
    {
        eyebrow: "Collaborate with your team",
        title: (
            <>
                Everyone sees the <span className="text-[color:var(--c-primary)]">same plan</span>
            </>
        ),
        body: "Lay the work out on a shared timeline. Product, design and engineering follow the same view of what is in flight and what lands next — no screenshots pasted into chat.",
        demo: <TimelineDemo />,
    },
]

const STEPS = [
    { icon: I.link, title: "Connect a repository", body: "Link a Git repo. There's nothing to install and no agent to run on your machines." },
    { icon: I.shield, title: "Ucelot maps it", body: "Your code is analysed in an isolated workspace and stored as a knowledge graph." },
    { icon: I.check, title: "Track grounded issues", body: "Open issues that cite the exact files and lines worth investigating." },
]

// Edge-to-edge on iOS: `cover` is what makes 100vh the whole screen and gates
// env(safe-area-inset-*), so the hero field reaches the physical edges instead
// of being letterboxed. Exported from the PAGE, not the root layout, so the app
// shell keeps the default `auto` and its chrome stays clear of the safe areas.
//
// themeColor does NOT drive Safari 26's bars (it samples <body> — see the
// landing-bar-tint block in globals.css, which is what actually tints them). It
// is still what Android Chrome and iOS < 26 read, hence the hero's gold rather
// than the page cream.
export const viewport: Viewport = {
    viewportFit: "cover",
    themeColor: "#fbd26a",
}

export default async function Home() {
    // Only whitelisted users are sent into the app. Signed-in users who
    // aren't on the beta list stay on the landing (they reach the waitlist
    // through sign-in, not by being bounced off this page).
    const user = await Supabase.currentUser()
    if (user && new BetaAccess().isAllowed(user)) redirect("/projects")

    // main is overflow-x-clip to contain the squircle polyfill's shadow layers.
    // On Safari/Firefox (no native corner-shape) hyperellipse redraws every
    // rounded-sq-* box as an SVG ::before and INFLATES that layer by the
    // box-shadow's blur so the shadow fits inside it — the "How it works" card
    // carries an 80px blur, so its layer ran 80px past the card on each side and
    // pushed the document 48px wider than a 390pt phone. Chrome builds no such
    // layer (it has corner-shape), so this only ever reproduced on the device.
    //
    // `clip`, not `hidden`: clip doesn't create a scroll container, so the
    // hero's `sticky top-0` still pins against the viewport.
    return (
        <main data-page="landing" className="overflow-x-clip bg-[#fffae8] text-[#1a100e]">
            {/* ─── Hero ─────────────────────────────────────────────────────
                The hero pins for the length of this runway. Across it the ember
                field shifts to the dark palette and ripples away to INK, and the
                manifesto rises through the hole the ripple opens — so the hero
                has already become the next section by the time it unpins. */}
            <div data-hero-runway className="relative h-[400vh]">
                <section className={`sticky top-0 flex h-screen flex-col items-start justify-center overflow-hidden ${SECTION_X}`}>
                    {/* Light ember, with the dark ember ramp fading in over it as
                        the ripple spreads — otherwise the tiles that survive the
                        dissolve keep their pale cream end (tuned for the cream
                        page) and read as specks of white on the dark. Same
                        lattice on both, so it plays as a palette shift rather
                        than a second texture. The ambient sweep runs only while
                        the hero is at rest; HeroField cuts it on first scroll so
                        the dissolve is the only motion during the transition. */}
                    <HeroField
                        lightStops={EMBER_STOPS}
                        darkStops={HERO_DARK_STOPS}
                        darkOpacity="clamp(0, calc((var(--hero-s, 0) - 0.03) / 0.34), 1)"
                    />
                    <HeroDissolve color={INK} />
                {/* Stays put while the field darkens — the copy recolours from
                    INK to cream in step with `--hero-s` instead of fading,
                    so the lockup and buttons survive the shift rather than
                    vanishing from under the reader. It only retires later, once
                    the ripple is well underway and the manifesto is due. */}
                <div
                    className="relative z-10 flex w-full max-w-xl flex-col items-start text-left"
                    style={{
                        color: `color-mix(in srgb, #1a100e, #ffffff calc(${INVERT} * 100%))`,
                        opacity: "clamp(0, calc((0.58 - var(--hero-p, 0)) / 0.24), 1)",
                    }}
                >
                    <div className="anim-rise flex items-center gap-4" style={{ animationDelay: "0ms" }}>
                        {/* Inverts with the field: an INK tile with a white
                            mark on cream becomes a white tile with a dark mark on
                            ink, so the lockup stays crisp instead of going dim.

                            Done as two stacked squircles cross-faded by opacity,
                            NOT an animated background-color: the hyperellipse
                            fallback (Safari/Firefox) bakes the fill into its SVG
                            layer by reading it from the stylesheet, so an inline
                            background on a .rounded-sq-* element renders grey —
                            the same trap .btn-github is commented for. Both
                            layers keep class-based backgrounds; only opacity and
                            the mark's colour are inline. */}
                        <div className="relative size-14 shrink-0">
                            <div className="absolute inset-0 rounded-sq-2xl bg-[#1a100e] shadow-[0_18px_46px_-12px_rgba(161,98,7,0.55)]" />
                            <div
                                className="absolute inset-0 rounded-sq-2xl bg-white"
                                style={{ opacity: INVERT }}
                            />
                            <div
                                className="absolute inset-0 p-2.5 pt-3"
                                style={{
                                    color: `color-mix(in srgb, #ffffff, ${INK} calc(${INVERT} * 100%))`,
                                }}
                            >
                                <BobbyMark />
                            </div>
                        </div>
                        <div className="flex flex-col items-start">
                            <h1 className="text-[44px] font-extrabold leading-none tracking-[-0.035em]">
                                Ucelot
                            </h1>
                            <span className="ml-1 text-[11px] font-extrabold uppercase tracking-[0.3em] ">
                                by Bobby
                            </span>
                        </div>
                    </div>
                    <p
                        className="anim-rise mt-20 max-w-md font-medium text-[15.5px] leading-7"
                        style={{ animationDelay: "120ms" }}
                    >
                        Smart issue tracker for your projects. Issues come with the files and lines worth investigating.
                    </p>
                    <div className="flex items-center space-x-4">
                        {/* Charcoal → near-black as the field darkens. Same
                            layered trick as the logo tile: an inline background
                            on a .rounded-sq-* element renders grey under the
                            Safari/Firefox hyperellipse fallback, so both fills
                            stay class-based and only opacity is inline. */}
                        <Link
                            href="/login"
                            className="anim-rise relative isolate mt-7 px-6 py-2.5 text-[14px] font-bold text-white"
                            style={{ animationDelay: "200ms" }}
                        >
                            <span className="absolute inset-0 -z-10 rounded-sq-xl bg-[#1a100e] shadow-[0_12px_36px_-8px_rgba(161,98,7,0.45)]" />
                            <span
                                className="absolute inset-0 -z-10 rounded-sq-xl bg-[#1a100e]"
                                style={{ opacity: INVERT }}
                            />
                            Start Now
                        </Link>
                        <Link
                            href="/docs"
                            className="bg-white rounded-sq-xl text-[#1a100e] font-bold  anim-rise mt-7 px-6 py-2.5 text-[14px] shadow-[0_12px_36px_-8px_rgba(161,98,7,0.45)]"
                            style={{ animationDelay: "200ms" }}
                        >
                            Documentation
                        </Link>
                    </div>
                </div>
                    {/* scroll cue */}
                    <div
                        className="absolute inset-x-0 bottom-7 z-10 flex justify-center text-[#1a100e]/40"
                        style={{ opacity: "clamp(0, calc((0.1 - var(--hero-s, 0)) / 0.1), 1)" }}
                    >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden className="animate-bounce">
                            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </div>

                    {/* ─── Manifesto reveal ─────────────────────────────────
                        Sits above the dissolve canvas and is clipped to a circle
                        that grows with the ripple, so the belief emerges through
                        the hole the pixels open rather than arriving on a later
                        scroll. The clip trails the pixel front (78% vs 100%) so
                        type never straddles the ragged edge. */}
                    <div
                        className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-8 text-center"
                        style={{ clipPath: "circle(calc(var(--hero-p, 0) * 78%) at 50% 55%)" }}
                    >
                        <div
                            className="max-w-3xl"
                            style={{
                                // The hole opens and spreads on its own first —
                                // `u` stays at 0 until the ripple is nearly done,
                                // so the type only starts rising once the dark has
                                // almost taken the screen, and settles during the
                                // calm beat before the hero unpins.
                                ["--u" as string]:
                                    "clamp(0, calc((var(--hero-p, 0) - 0.74) / 0.26), 1)",
                                opacity: "var(--u)",
                                transform: "translateY(calc((1 - var(--u)) * 46px))",
                            }}
                        >
                            <h2 className="text-[38px] font-extrabold leading-[1.05] tracking-[-0.03em] text-[#fffae8] sm:text-[64px]">
                                Great products
                                <br />
                                still need{" "}
                                <span className="relative whitespace-nowrap text-[color:var(--c-primary)]">
                                    you
                                    <svg
                                        className="absolute -bottom-2 left-0 w-full"
                                        height="12"
                                        viewBox="0 0 100 12"
                                        preserveAspectRatio="none"
                                        fill="none"
                                        aria-hidden
                                    >
                                        <path d="M1 8c22-5 54-6 98-2" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.45" />
                                    </svg>
                                </span>
                                .
                            </h2>
                            <p className="mx-auto mt-10 max-w-xl text-[17px] leading-8 text-[#fffae8]/70 sm:text-[19px] sm:leading-9">
                                Ucelot isn&apos;t an AI built to replace the people who build
                                software. It&apos;s one that does the reading, so you can do the
                                thinking.
                            </p>
                        </div>
                    </div>
                </section>
            </div>

            {/* ─── Concept ──────────────────────────────────────────────────
                The belief the product is built on, told a beat at a time. Each
                line gets its own stretch of screen and rises as it enters, so
                the argument arrives in steps rather than as a wall of prose —
                the reader can only be on one thought at a time. Painted in INK,
                the colour the hero ripples into, so this is where the dissolve
                lands. */}
            <section
                className={`relative -mt-px ${SECTION_X} pt-24 pb-28 sm:pt-28`}
                style={{ backgroundColor: INK }}
            >
                <DemoStyles />
                <div className="mx-auto flex max-w-6xl flex-col gap-32 sm:gap-44 lg:gap-52">
                    {SHOWCASE.map((row) => (
                        <div
                            key={row.eyebrow}
                            className="grid items-center gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] lg:gap-14"
                        >
                            {/* min-w-0 on both grid items, or the row can't get
                                narrower than the demo window's intrinsic width.
                                A grid item defaults to min-width:auto — its
                                min-content — and the demo miniatures carry
                                fixed-width internals adding up to ~390px, which
                                became the whole DOCUMENT's floor: every phone
                                under 390pt scrolled sideways (70px at 320,
                                16px at 375). The windows clip their own
                                overflow, so letting them shrink is safe. */}
                            <Reveal className="min-w-0">
                                <div className="max-w-sm">
                                    <span className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-[color:var(--c-primary)]">
                                        {row.eyebrow}
                                    </span>
                                    <h3 className="mt-4 text-[28px] font-extrabold leading-[1.15] tracking-[-0.025em] text-[#fffae8] sm:text-[38px]">
                                        {row.title}
                                    </h3>
                                    <p className="mt-4 text-[15px] leading-8 text-[#fffae8]/60 sm:text-[16px]">
                                        {row.body}
                                    </p>
                                </div>
                            </Reveal>
                            {/* The demo trails the copy in slightly, so the eye
                                reads the claim before the thing proving it. */}
                            <Reveal delay={140} className="min-w-0">{row.demo}</Reveal>
                        </div>
                    ))}
                </div>
            </section>

            {/* Ink breaks apart into the cream page on the same 48px lattice —
                the counterpart to the ripple that carried the hero in. */}
            <div className="relative h-[220px] overflow-hidden sm:h-[280px]">
                <PixelEdge color={INK} direction="down" />
            </div>

            {/* ─── How it works ─────────────────────────────────────────── */}
            <section className={`${SECTION_X} py-24`}>
                <div className="mx-auto max-w-6xl rounded-sq-xl bg-white/60 p-8 shadow-[0_30px_80px_-50px_rgba(161,98,7,0.5)] sm:p-12">
                    <Eyebrow>How it works</Eyebrow>
                    <h2 className="mt-3 text-[30px] font-extrabold leading-[1.12] tracking-[-0.02em] sm:text-[36px]">
                        From repo to grounded issues.
                    </h2>
                    <div className="mt-10 grid gap-8 sm:grid-cols-3">
                        {STEPS.map((s, i) => (
                            <div key={s.title} className="relative">
                                <div className="flex items-center gap-3">
                                    <GlyphTile>{s.icon}</GlyphTile>
                                    <span className="text-[13px] font-extrabold text-[#1a100e]/40">
                                        0{i + 1}
                                    </span>
                                </div>
                                <h3 className="mt-4 text-[16px] font-extrabold tracking-[-0.01em]">{s.title}</h3>
                                <p className="mt-1.5 text-[13.5px] leading-6 text-[#1a100e]/70">{s.body}</p>
                            </div>
                        ))}
                    </div>
                    <Link
                        href="/docs/data-processing"
                        className="mt-9 inline-flex items-center gap-1.5 text-[13.5px] font-bold text-[color:var(--c-accent)] hover:underline"
                    >
                        See exactly how your data is processed
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </Link>
                </div>
            </section>

            {/* ─── CTA band ─────────────────────────────────────────────────
                Ucelot isn't open yet: signing in puts anyone who isn't on the
                beta list onto /waitlist, so "join the waitlist" is what the
                button actually does. Saying "Start Now" and landing them on a
                holding page would be a bait. */}
            <section className={`${SECTION_X} pb-24`}>
                <div className="mx-auto max-w-6xl overflow-hidden rounded-sq-xl bg-[#1a100e] px-8 py-16 text-center sm:px-16">
                    <span className="inline-flex items-center gap-2 rounded-full border border-[#fffae8]/20 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#fffae8]/70">
                        <span className="size-1.5 rounded-full bg-[color:var(--c-primary)]" />
                        Private beta
                    </span>
                    <h2 className="mx-auto mt-5 max-w-2xl text-[30px] font-extrabold leading-[1.12] tracking-[-0.02em] text-[#fffae8] sm:text-[38px]">
                        Be there when Ucelot opens up.
                    </h2>
                    <p className="mx-auto mt-4 max-w-md text-[15px] leading-7 text-[#fffae8]/70">
                        We&apos;re onboarding teams a few at a time. Join the waitlist and we&apos;ll
                        get in touch as soon as there&apos;s room for yours.
                    </p>
                    <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
                        <Link
                            href="/login"
                            className="rounded-sq-xl bg-[#fffae8] px-7 py-3 text-[14px] font-bold text-[#1a100e] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.5)] transition-transform hover:-translate-y-0.5"
                        >
                            Join the waitlist
                        </Link>
                        <Link
                            href="/docs"
                            className="rounded-sq-xl border border-[#fffae8]/25 px-7 py-3 text-[14px] font-bold text-[#fffae8] transition-colors hover:bg-white/5"
                        >
                            Read the docs
                        </Link>
                    </div>
                </div>
            </section>

            {/* ─── Footer ───────────────────────────────────────────────── */}
            {/* pb clears the home indicator: with viewport-fit=cover the footer
                now runs under it, so the inset is added to the 2.5rem rather
                than replacing it (env() is 0 everywhere else). */}
            <footer
                className={`${SECTION_X} border-t border-[#1a100e]/10 pt-14 pb-[calc(2.5rem+env(safe-area-inset-bottom))]`}
            >
                <div className="mx-auto max-w-6xl">
                    <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                        {/* Brand + newsletter */}
                        <div>
                            <div className="flex items-center gap-2.5">
                                <span className="grid size-8 place-items-center rounded-sq bg-[#1a100e] p-1.5 text-white">
                                    <BobbyMark />
                                </span>
                                <span className="text-[14px] font-extrabold tracking-[-0.01em]">Ucelot</span>
                                <span className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#1a100e]/40">
                                    by Bobby
                                </span>
                            </div>
                            <p className="mt-4 max-w-xs text-[13.5px] leading-6 text-[#1a100e]/70">
                                Issue tracking that reads your code — every issue tied back to the
                                files and lines it&apos;s actually about.
                            </p>
                            <h3 className="mt-8 text-[12px] font-extrabold uppercase tracking-[0.16em] text-[#1a100e]/45">
                                Newsletter
                            </h3>
                            <p className="mt-2 text-[13.5px] leading-6 text-[#1a100e]/70">
                                Occasional notes on what we&apos;re building. No noise.
                            </p>
                            <NewsletterForm />
                        </div>

                        {/* Link columns */}
                        <div className="grid gap-8 sm:grid-cols-3">
                            <FooterCol title="Product">
                                <FooterLink href="/login">Join the waitlist</FooterLink>
                                <FooterLink href="/login">Sign in</FooterLink>
                            </FooterCol>
                            <FooterCol title="Documentation">
                                <FooterLink href="/docs">Overview</FooterLink>
                                <FooterLink href="/docs/intelligence">Intelligence</FooterLink>
                                <FooterLink href="/docs/graph-analysis">Graph analysis</FooterLink>
                                <FooterLink href="/docs/issues">Issues</FooterLink>
                            </FooterCol>
                            <FooterCol title="Trust">
                                <FooterLink href="/docs/data-processing">Data processing</FooterLink>
                            </FooterCol>
                        </div>
                    </div>

                    <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-[#1a100e]/10 pt-6 text-[12.5px] text-[#1a100e]/55 sm:flex-row sm:items-center">
                        <p>© {new Date().getFullYear()} Bobby. All rights reserved.</p>
                        <p>Made for teams who&apos;d rather read code than guess.</p>
                    </div>
                </div>
            </footer>
        </main>
    )
}
