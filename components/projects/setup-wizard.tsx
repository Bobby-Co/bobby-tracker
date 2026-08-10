"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { cn } from "@/components/ui/cn"
import { BobbyMark, BOBBY_MARK_PATH } from "@/components/layout/brand-lockup"
import type { GithubSyncDirection } from "@/lib/shared/types"
import {useRouter} from "next/navigation";

// SetupWizard — the presentational first-run onboarding: three animated scenes
// (GitHub sync mode → auto-update → index depth) with a build CTA. Pure UI: it
// owns the step/selection/animation state and reports choices through callbacks,
// so the real project page can wire it to the APIs while /preview/setup-wizard
// renders it with stubs for debugging.

export type WizardDir = GithubSyncDirection | "off"
export type WizardEffort = "low" | "medium" | "high"

export interface SetupWizardProps {
    projectName: string
    /** Which VCS this project syncs with — drives labels + the connect step.
     *  GitLab sync is provisioned automatically at create, so its "connect" step
     *  is informational, not a GitHub-App install. */
    provider?: "github" | "gitlab"
    /** null = unknown/loading; false = not connected/provisioned; true = connected.
     *  For GitLab this reflects sync being enabled (auto-provisioned), not an App. */
    installed: boolean | null
    initialDir?: WizardDir
    initialAutoUpdate?: boolean
    initialEffort?: WizardEffort
    /** Where the "delete it" escape link points (real: the Settings tab). */
    deleteHref: string
    /** Kick the GitHub App install/connect flow. */
    onConnect: () => void
    /** Persist the chosen sync direction (fired when leaving scene 1). */
    onSaveGithub: (dir: WizardDir) => void
    /** Persist the auto-update toggle (fired when leaving scene 2). */
    onSaveAutoUpdate: (on: boolean) => void
    /** Start the first index at the chosen depth. May reject to surface an error. */
    onBuild: (effort: WizardEffort) => Promise<void> | void
}

const STEPS = ["GitHub", "Updates", "Index"]
const EASE = [0.16, 1, 0.3, 1] as const

export function SetupWizard({
    projectName,
    provider = "github",
    installed,
    initialDir = "both",
    initialAutoUpdate = true,
    initialEffort = "medium",
    deleteHref,
    onConnect,
    onSaveGithub,
    onSaveAutoUpdate,
    onBuild,
}: SetupWizardProps) {
    const reduce = useReducedMotion()
    const label = provider === "gitlab" ? "GitLab" : "GitHub"
    const [step, setStep] = useState(0)
    const [dir, setDir] = useState<WizardDir>(initialDir)
    const router = useRouter()
    const [autoUpdate, setAutoUpdate] = useState(initialAutoUpdate)
    const [effort, setEffort] = useState<WizardEffort>(initialEffort)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    // The GitHub step gates progress: any sync direction other than "off" needs
    // the App actually connected. "Off" opts out of GitHub entirely, so it's free
    // to continue. installed === null (still loading) blocks too — we only advance
    // once we know it's connected.
    const githubBlocked = step === 0 && dir !== "off" && installed !== true

    function next() {
        if (githubBlocked) return
        if (step === 0) onSaveGithub(dir)
        if (step === 1) onSaveAutoUpdate(autoUpdate)
        setStep((s) => Math.min(STEPS.length - 1, s + 1))
    }

    async function build() {
        setErr(null)
        setBusy(true)
        try {
            await onBuild(effort)
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Couldn't start indexing")
        } finally {
            setBusy(false)
        }
    }

    const isLast = step === STEPS.length - 1

    return (
        <div className="relative mx-auto flex min-h-full w-full max-w-xl flex-col justify-center gap-7 overflow-hidden py-8">
            <AmbientGlow reduce={!!reduce} step={step} />

            <div className="relative">
                <div className="text-[12px] font-semibold uppercase tracking-[0.09em] text-[color:var(--c-primary)]">
                    Set up {projectName || "your project"}
                </div>
                <Dots step={step} />
            </div>

            {/* Fixed height so scenes of different natural heights don't shift the
                nav row below. Each scene is vertically centred within it. */}
            <div className="relative h-[360px]">
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                        key={step}
                        className="flex h-full flex-col justify-center"
                        initial={{ opacity: 0, x: reduce ? 0 : 32 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: reduce ? 0 : -32 }}
                        transition={{ duration: 0.4, ease: EASE }}
                    >
                        {step === 0 && <GithubScene dir={dir} onPick={setDir} installed={installed} onConnect={onConnect} reduce={!!reduce} provider={provider} label={label} />}
                        {step === 1 && <AutoUpdateScene defaultOn={autoUpdate} onToggle={() => setAutoUpdate((v) => !v)} reduce={!!reduce} />}
                        {step === 2 && <EffortScene value={effort} onPick={setEffort} reduce={!!reduce} />}
                    </motion.div>
                </AnimatePresence>
            </div>

            {err && <p className="relative text-center text-[12.5px] text-rose-700">{err}</p>}

            <div className="relative flex items-center justify-between">
                <button
                    type="button"
                    onClick={() => setStep((s) => {
                        if (s === 0) {
                            router.push("/projects")
                        }
                        return Math.max(0, s - 1)
                    })}
                    disabled={busy}
                    className="btn-ghost disabled:opacity-0"
                >
                    Back
                </button>
                {!isLast ? (
                    <button
                        type="button"
                        onClick={next}
                        disabled={githubBlocked}
                        title={githubBlocked ? `Connect ${label} first, or choose “No sync” to skip it` : undefined}
                        className="btn-primary min-w-[120px] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Continue
                    </button>
                ) : (
                    <button type="button" onClick={build} disabled={busy} className="btn-primary min-w-[160px] disabled:opacity-60">
                        {busy ? "Starting…" : "Build the graph →"}
                    </button>
                )}
            </div>

            <div className="relative text-center">
                <Link href={deleteHref} className="text-[12px] text-[color:var(--c-text-dim)] transition-colors hover:text-rose-600 hover:underline">
                    Don’t want this project? Delete it
                </Link>
            </div>
        </div>
    )
}

// ── Scene 1: GitHub sync mode ────────────────────────────────────────────────

function makeDirs(label: string): { val: WizardDir; short: string; title: string; blurb: string; icon: React.ReactNode }[] {
    return [
        { val: "both", short: "Two-way", title: "Two-way sync", blurb: "Issues and PRs stay in sync both ways — edit on either side, and the other follows.", icon: <TwoWayIcon /> },
        { val: "inbound", short: "In", title: `${label} → Ucelot`, blurb: `${label} is the source of truth. Changes there flow into Ucelot; nothing is pushed back.`, icon: <ArrowRightIcon /> },
        { val: "outbound", short: "Out", title: `Ucelot → ${label}`, blurb: `Ucelot is the source of truth. What you do here is pushed to ${label}, not the reverse.`, icon: <ArrowLeftIcon /> },
        { val: "off", short: "Off", title: "No sync", blurb: "No issue or PR mirroring. You can still index the code and use Mind.", icon: <OffIcon /> },
    ]
}

function GithubScene({
    dir,
    onPick,
    installed,
    onConnect,
    reduce,
    provider,
    label,
}: {
    dir: WizardDir
    onPick: (d: WizardDir) => void
    installed: boolean | null
    onConnect: () => void
    reduce: boolean
    provider: "github" | "gitlab"
    label: string
}) {
    const DIRS = makeDirs(label)
    return (
        <motion.div layout="position" className="flex flex-col items-center gap-5 text-center">
            <SceneTitle>Sync issues &amp; PRs with {label}</SceneTitle>

            <FlowDiagram dir={dir} reduce={reduce} />

            <div className="inline-flex rounded-[12px] border border-[color:var(--c-border)] bg-white p-1">
                {DIRS.map((d) => (
                    <button
                        key={d.val}
                        type="button"
                        onClick={() => onPick(d.val)}
                        title={d.title}
                        className={cn(
                            "flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12px] font-semibold transition-colors",
                            dir === d.val
                                ? "bg-[color:var(--c-primary-tint)] text-[color:var(--c-primary)]"
                                : "text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]",
                        )}
                    >
                        {d.icon}
                        <span>{d.short}</span>
                    </button>
                ))}
            </div>

            <div className="min-h-[42px]">
                <AnimatePresence mode="wait">
                    <motion.p
                        key={dir}
                        initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: reduce ? 0 : -6 }}
                        transition={{ duration: 0.28, ease: EASE }}
                        className="max-w-sm text-[13px] leading-6 text-[color:var(--c-text-muted)]"
                    >
                        {DIRS.find((d) => d.val === dir)?.blurb}
                    </motion.p>
                </AnimatePresence>
            </div>

            {installed === false && dir !== "off" && provider === "github" && (
                <button
                    type="button"
                    onClick={onConnect}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--c-border)] bg-white px-3 py-1.5 text-[12px] font-semibold text-[color:var(--c-text)] hover:border-[color:var(--c-border-strong)]"
                >
                    <GithubMark /> Connect the GitHub App to activate
                </button>
            )}
            {/* GitLab sync is provisioned automatically at create; if it didn't
                activate, point the user to Connections rather than an App install. */}
            {installed === false && dir !== "off" && provider === "gitlab" && (
                <span className="max-w-sm text-[12px] text-amber-700">
                    GitLab sync isn’t active yet — check that {label} is connected in Settings → Connections.
                </span>
            )}
            {installed && (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-700">
                    <DotPulse reduce={reduce} /> {provider === "gitlab" ? "GitLab sync connected" : "GitHub App connected"}
                </span>
            )}
        </motion.div>
    )
}

// Two nodes that lob a parcel back and forth along arcs — GitHub throws over the
// top to Ucelot, Ucelot throws back under the bottom. The parcels tumble along
// the curve (offset-path auto-rotate); the arc + toss reads as "syncing", far
// less robotic than dots sliding down a wire. Paths are in the 300×96 px space.
const ARC_FWD = "M 48 48 Q 150 6 252 48"
const ARC_BACK = "M 252 48 Q 150 90 48 48"

function FlowDiagram({ dir, reduce }: { dir: WizardDir; reduce: boolean }) {
    const forward = dir === "both" || dir === "inbound"
    const back = dir === "both" || dir === "outbound"
    const both = forward && back
    return (
        <div className="relative h-24 w-[300px] max-w-full">
            {!reduce && (forward || back) && (
                <svg viewBox="0 0 300 96" className="absolute inset-0 h-full w-full" fill="none" aria-hidden>
                    {forward && <path d={ARC_FWD} stroke="var(--c-border)" strokeWidth="1" strokeDasharray="2 6" strokeLinecap="round" />}
                    {back && <path d={ARC_BACK} stroke="var(--c-border)" strokeWidth="1" strokeDasharray="2 6" strokeLinecap="round" />}
                </svg>
            )}

            <div className="absolute left-0 top-1/2 -translate-y-1/2">
                <Node label="GitHub">
                    <GithubMark />
                </Node>
            </div>
            <div className="absolute right-0 top-1/2 -translate-y-1/2">
                <Node label="Ucelot">
                    <UcelotLogo />
                </Node>
            </div>

            {!reduce && forward && <Parcel path={ARC_FWD} tone="var(--c-primary)" anim={both ? "wizard-fly-a" : "wizard-fly-solo"} />}
            {!reduce && back && <Parcel path={ARC_BACK} tone="#3fb950" anim={both ? "wizard-fly-b" : "wizard-fly-solo"} />}

            {dir === "off" && (
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white px-2 text-[10px] font-semibold text-[color:var(--c-text-dim)]">
                    paused
                </span>
            )}
        </div>
    )
}

// Parcel — a little package tossed along `path`. Driven by a CSS keyframe (see
// globals.css `wizard-fly-*`) rather than framer-motion so it animates on the
// very first paint; offset-path carries it along the curve. `anim` picks the
// interleave (two-way) or the solo loop; the two-way pair share a 3s cycle.
function Parcel({ path, tone, anim }: { path: string; tone: string; anim: string }) {
    const solo = anim === "wizard-fly-solo"
    return (
        <span
            className="absolute left-0 top-0 h-[11px] w-[11px] rounded-[3px] shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
            style={{
                offsetPath: `path("${path}")`,
                offsetAnchor: "50% 50%",
                backgroundColor: tone,
                animation: `${anim} ${solo ? "1.8s" : "3s"} ${solo ? "ease-out" : "ease-in-out"} infinite`,
            }}
        />
    )
}

function Node({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex shrink-0 flex-col items-center gap-1">
            <span className="grid h-11 w-11 place-items-center rounded-[14px] border border-[color:var(--c-border)] bg-white text-[color:var(--c-text)] shadow-[var(--shadow-card)]">
                {children}
            </span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">{label}</span>
        </div>
    )
}

// ── Scene 2: auto-update ─────────────────────────────────────────────────────

function AutoUpdateScene({ defaultOn, onToggle, reduce }: { defaultOn: boolean; onToggle: () => void; reduce: boolean }) {
    // One-shot confetti, keyed by `burst` so each fire remounts the (non-looping)
    // confetti. burst starts at 0 → nothing renders on mount. The ARRIVAL pop is
    // held until the scene's ~0.4s enter transition settles, so it doesn't fire
    // mid-slide. `armed` disarms that timer once the user toggles, so an early
    // interaction doesn't double-fire it. Toggle-on always pops immediately.
    const [burst, setBurst] = useState(0)
    const armed = useRef(true)
    const [on, setOn] = useState(false)
    const [initial, setInitial] = useState(true)
    useEffect(() => {
        if (reduce) return
        if (defaultOn) {
            const t = setTimeout(() => {
                setOn(true)
                setTimeout(() => {
                    setBurst((b) => b + 1)
                }, 150)
                setInitial(false)
            }, 500)
            return () => clearTimeout(t)
        }else{
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setInitial(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (initial) return
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOn(defaultOn)
    }, [defaultOn, initial])

    function toggle() {
        armed.current = false
        if (!on) {
            setTimeout(() => {
                setBurst((b) => b + 1)
            }, 150)
        } // turning on → pop
        onToggle()
    }
    return (
        <motion.div layout="position" className="flex flex-col items-center gap-6 text-center">
            <SceneTitle>Keep the graph fresh</SceneTitle>

            <div className="relative grid place-items-center">
                <BigToggle on={on} onToggle={toggle} reduce={reduce} />
                {!reduce && burst > 0 && (
                    // Anchor the burst at the knob's "on" spot (right of centre) so
                    // the confetti spits out of the right side as it snaps on.
                    <div key={burst} className="pointer-events-none absolute left-1/2 top-1/2" style={{ transform: "translate(44px, 0)" }} aria-hidden>
                        <Confetti />
                    </div>
                )}
            </div>

            <motion.p
                key={on ? "on" : "off"}
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="max-w-xs text-[13.5px] leading-6 text-[color:var(--c-text-muted)]"
            >
                {on ? (
                    <>
                        On every push, Ucelot re-reads what changed — so its knowledge never goes stale.{" "}
                        <span className="font-semibold text-[color:var(--c-text)]">We suggest leaving this on.</span>
                    </>
                ) : (
                    <>You’ll re-index manually when you want the graph to catch up.</>
                )}
            </motion.p>

            {on && (
                <span className="rounded-full bg-[color:var(--c-primary-tint)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-primary)]">
                    Recommended
                </span>
            )}
        </motion.div>
    )
}

function BigToggle({ on, onToggle, reduce }: { on: boolean; onToggle: () => void; reduce: boolean }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Auto-update on push"
            onClick={onToggle}
            className={cn(
                "relative flex h-16 w-28 items-center rounded-full p-2 transition-colors duration-300",
                on ? "bg-[color:var(--c-primary)]" : "bg-zinc-300",
            )}
        >
            <motion.span
                // Slide via translateX (the track is w-28/112, p-2/8, knob w-12/48 →
                // travel = 112 - 16 - 48 = 48). margin:auto can't be transitioned.
                animate={{ x: on ? 48 : 0 }}
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 30 }}
                className="grid h-12 w-12 place-items-center rounded-full bg-white shadow-md"
            >
                <motion.span
                    key={on ? "on" : "off"}
                    initial={{ scale: 0.6, opacity: 0, rotate: reduce ? 0 : -30 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    transition={{ duration: 0.28, ease: EASE }}
                    className={on ? "text-[color:var(--c-primary)]" : "text-zinc-400"}
                >
                    {on ? <RefreshMark /> : <PauseMark />}
                </motion.span>
            </motion.span>
        </button>
    )
}

// Confetti — a single celebratory burst (no repeat). Each bit fans upward and
// out, then falls with a little gravity, spinning and fading. Remounted (via a
// changing key) each time the toggle snaps on, so it plays once per flip.
const CONFETTI_COLORS = ["#e9730f", "#f6a723", "#3fb950", "#f7d154", "#ef8f3c"]

// Bits fire in a cone facing RIGHT (±62° around +x) from the anchored origin,
// arc up, then fall with a little gravity — spinning and fading. One-shot.
function Confetti() {
    const bits = Array.from({ length: 18 }, (_, i) => i)
    return (
        <>
            {bits.map((i) => {
                const t = bits.length > 1 ? i / (bits.length - 1) : 0.5
                const angle = (-62 + 124 * t) * (Math.PI / 180)
                const dist = 58 + (i % 4) * 16
                const dx = Math.cos(angle) * dist // rightward
                const peak = Math.sin(angle) * dist // up (neg) or down
                const fall = 40 + (i % 3) * 26
                const rot = (i % 2 ? 1 : -1) * (200 + (i % 4) * 110)
                const c = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
                const w = i % 2 ? 4 : 6
                const h = i % 2 ? 9 : 5
                return (
                    <motion.span
                        key={i}
                        className="absolute left-0 top-0 rounded-[1px]"
                        style={{ width: w, height: h, backgroundColor: c }}
                        initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
                        animate={{ x: dx, y: [0, peak, peak + fall], opacity: [1, 1, 0], rotate: rot, scale: 1 }}
                        transition={{ duration: 1.05 + (i % 3) * 0.18, ease: "easeOut" }}
                    />
                )
            })}
        </>
    )
}

// ── Scene 3: index depth ─────────────────────────────────────────────────────

const EFFORTS: { val: WizardEffort; label: string; blurb: string; bars: number }[] = [
    { val: "low", label: "Quick", blurb: "A fast, lean first pass. Cheapest — fills in over time as you commit.", bars: 1 },
    { val: "medium", label: "Balanced", blurb: "A solid graph without the wait. The sweet spot for most repos.", bars: 2 },
    { val: "high", label: "Thorough", blurb: "The deepest first pass. Best for big or unfamiliar codebases. Slower, pricier.", bars: 3 },
]

function EffortScene({ value, onPick, reduce }: { value: WizardEffort; onPick: (e: WizardEffort) => void; reduce: boolean }) {
    const active = EFFORTS.find((e) => e.val === value) ?? EFFORTS[1]
    return (
        <div className="flex flex-col items-center gap-5 text-center">
            <SceneTitle>How deep should the first index go?</SceneTitle>

            <EffortPile value={value} reduce={reduce} />

            <div className="grid w-full grid-cols-3 gap-2">
                {EFFORTS.map((e) => (
                    <button
                        key={e.val}
                        type="button"
                        onClick={() => onPick(e.val)}
                        className={cn(
                            "relative rounded-[12px] border px-2 py-2.5 text-[12.5px] font-semibold transition-colors",
                            value === e.val
                                ? "border-[color:var(--c-primary)] bg-[color:var(--c-primary-tint)] text-[color:var(--c-text)]"
                                : "border-[color:var(--c-border)] bg-white text-[color:var(--c-text-muted)] hover:border-[color:var(--c-border-strong)]",
                        )}
                    >
                        {e.label}
                        {e.val === "medium" && (
                            <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[color:var(--c-primary)] px-1.5 py-[1px] text-[8.5px] font-bold uppercase tracking-[0.05em] text-white">
                                Suggested
                            </span>
                        )}
                    </button>
                ))}
            </div>

            <div className="min-h-[42px]">
                <AnimatePresence mode="wait">
                    <motion.p
                        key={value}
                        initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: reduce ? 0 : -6 }}
                        transition={{ duration: 0.28, ease: EASE }}
                        className="max-w-sm text-[13px] h-[48px] leading-6 text-[color:var(--c-text-muted)]"
                    >
                        {active.blurb}
                    </motion.p>
                </AnimatePresence>
            </div>
        </div>
    )
}

// ── Scene 3 physics: BobbyMarks fall into a "knowledge jar" as depth rises ─────
// A tiny custom sim on a canvas (no physics engine): each mark falls under
// gravity into a pre-computed pile slot with a small bounce, drawn as a cached
// Path2D. Raising the tier drops more marks onto the top of the pile; lowering
// it lets the top few fall out the bottom. The rAF loop stops the instant every
// mark settles — idle is zero cost.
const EFFORT_COUNT: Record<WizardEffort, number> = { low: 5, medium: 10, high: 20 }
const PILE = {
    W: 260,
    H: 172,
    S: 24, // mark draw size
    binL: 70,
    binR: 190,
    binTop: 54,
    binBottom: 164,
    cx: 130,
    innerHalf: 44, // usable half-width — keeps marks inside the jar walls
    G: 0.9, // gravity, px/frame²
}
// Mound rest slots, filled bottom-up and CONTAINED within the walls (narrowing
// to a peak at the rim — row 0 sits on the floor). MOUND is the jar's capacity
// (== the top tier). The extra SPILL marks are a reserve that pours over the rim
// and falls away when the top tier is chosen — the "it's overflowing" moment.
const ROW_W = [4, 4, 4, 3, 3, 2]
const SLOTS: { x: number; y: number }[] = (() => {
    const out: { x: number; y: number }[] = []
    for (let r = 0; r < ROW_W.length; r++) {
        const w = ROW_W[r]
        const y = 152 - r * 20
        const half = Math.min(PILE.innerHalf, (w - 1) * 13)
        for (let c = 0; c < w; c++) {
            out.push({ x: w === 1 ? PILE.cx : PILE.cx - half + (c / (w - 1)) * 2 * half, y })
        }
    }
    return out
})()
const MOUND = SLOTS.length // jar capacity (== high tier count)
const SPILL = 6 // reserve marks that overflow the top on the top tier
const MARK_SLOTS = MOUND + SPILL
type Mark = {
    active: boolean
    state: "rest" | "in" | "out" | "spill"
    x: number
    y: number
    vx: number
    vy: number
    rot: number
    vr: number
    restX: number
    restY: number
    spawnAt: number
}
// stepPile advances every moving mark one frame; returns whether anything is
// still in motion (or waiting to spawn) so the caller knows to keep looping.
function stepPile(marks: Mark[], now: number): boolean {
    let moving = false
    for (const m of marks) {
        if (!m.active || m.state === "rest") continue
        if (m.spawnAt && now < m.spawnAt) {
            moving = true
            continue
        }
        m.vy += PILE.G
        m.y += m.vy
        if (m.state === "in") {
            m.rot += m.vr * 0.25
            if (m.y >= m.restY) {
                if (m.vy > 1.5) {
                    m.y = m.restY
                    m.vy = -m.vy * 0.32 // damped bounce
                } else {
                    m.y = m.restY
                    m.vy = 0
                    m.state = "rest"
                }
            }
            if (m.state !== "rest") moving = true
        } else {
            // A spill mark falls from ABOVE; the moment it reaches the full jar's
            // brim it can't fit, so it deflects off to its side and tumbles down the
            // outside. `out` marks (tier-down) keep vx=0 and just drop straight.
            if (m.state === "spill" && m.vx === 0 && m.y >= PILE.binTop + 2) {
                const dir = m.x < PILE.cx ? -1 : 1
                m.vx = dir * (2 + Math.random() * 1.7)
                m.vr = dir * (0.22 + Math.random() * 0.3)
                if (m.vy > 1.4) m.vy = 1.4 // trade some drop for a sideways roll
            }
            m.x += m.vx
            m.rot += m.vr
            if (m.y > PILE.H + 28 || m.x < -30 || m.x > PILE.W + 30) m.active = false
            else moving = true
        }
    }
    return moving
}
function paintPile(ctx: CanvasRenderingContext2D, marks: Mark[], path: Path2D | null, color: string) {
    ctx.clearRect(0, 0, PILE.W, PILE.H)
    // The jar: an open-top U with rounded bottom corners + a whisper of tint.
    ctx.beginPath()
    ctx.moveTo(PILE.binL, PILE.binTop)
    ctx.lineTo(PILE.binL, PILE.binBottom - 7)
    ctx.arcTo(PILE.binL, PILE.binBottom, PILE.binL + 7, PILE.binBottom, 7)
    ctx.lineTo(PILE.binR - 7, PILE.binBottom)
    ctx.arcTo(PILE.binR, PILE.binBottom, PILE.binR, PILE.binBottom - 7, 7)
    ctx.lineTo(PILE.binR, PILE.binTop)
    ctx.fillStyle = "rgba(233,115,15,0.035)"
    ctx.fill()
    ctx.strokeStyle = "rgba(17,24,39,0.12)"
    ctx.lineWidth = 1.5
    ctx.stroke()
    if (path) {
        const s = PILE.S / 106
        for (const m of marks) {
            if (!m.active) continue
            const leaving = m.state === "out" || m.state === "spill"
            const alpha = leaving ? Math.max(0, Math.min(1, (PILE.binBottom + 12 - m.y) / 42)) : 1
            if (alpha <= 0) continue
            ctx.save()
            ctx.globalAlpha = alpha
            ctx.translate(m.x, m.y)
            ctx.rotate(m.rot)
            ctx.scale(s, s)
            ctx.translate(-53, -51)
            ctx.fillStyle = color
            ctx.fill(path)
            ctx.restore()
        }
    }
    ctx.globalAlpha = 1
}

function EffortPile({ value, reduce }: { value: WizardEffort; reduce: boolean }) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const marksRef = useRef<Mark[]>([])
    const rafRef = useRef(0)
    const pathRef = useRef<Path2D | null>(null)
    const colorRef = useRef("#e9730f")
    const prevCountRef = useRef(EFFORT_COUNT[value])

    // Init once: size the canvas, build the Path2D + colour, and seed the pile
    // EMPTY. The tier-change effect below also fires on mount and — seeing
    // prevCount 0 → current — drops the marks in as the scene's ENTRY animation,
    // so the jar fills the instant the page appears (reduced motion snap-fills
    // there instead).
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        canvas.width = PILE.W * dpr
        canvas.height = PILE.H * dpr
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        pathRef.current = new Path2D(BOBBY_MARK_PATH)
        colorRef.current = getComputedStyle(canvas).getPropertyValue("--c-primary").trim() || "#e9730f"

        const marks: Mark[] = []
        for (let i = 0; i < MARK_SLOTS; i++) {
            const mound = i < MOUND
            const bx = mound ? SLOTS[i].x : PILE.cx
            const by = mound ? SLOTS[i].y : PILE.binTop - 6
            const restX = bx + (mound ? (Math.random() - 0.5) * 8 : 0)
            const restY = by + (mound ? (Math.random() - 0.5) * 3 : 0)
            marks.push({
                // Start inactive so the tier-change effect drops them in on mount.
                active: false, state: "rest",
                x: restX, y: restY, vx: 0, vy: 0, rot: (Math.random() - 0.5) * 0.4, vr: (Math.random() - 0.5) * 0.3,
                restX, restY, spawnAt: 0,
            })
        }
        marksRef.current = marks
        prevCountRef.current = 0 // → the tier effect animates 0 → current on mount
        paintPile(ctx, marks, pathRef.current, colorRef.current)

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
            // Reset so a remount can start a fresh loop. Without this, Strict
            // Mode's mount→unmount→remount leaves a stale (cancelled) id here,
            // and the entry drop's `if (!rafRef.current)` guard never re-fires —
            // the jar would stay empty on the second mount.
            rafRef.current = 0
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // On tier change: drop the new marks in (rising) or let the top ones fall
    // out (falling), then run the sim until it settles.
    useEffect(() => {
        const marks = marksRef.current
        const canvas = canvasRef.current
        if (!marks.length || !canvas) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        const newCount = EFFORT_COUNT[value]
        const prev = prevCountRef.current
        if (newCount === prev) return
        prevCountRef.current = newCount

        if (reduce) {
            for (let i = 0; i < MARK_SLOTS; i++) {
                const m = marks[i]
                m.active = i < newCount
                m.state = "rest"
                m.x = m.restX
                m.y = m.restY
                m.vy = 0
            }
            paintPile(ctx, marks, pathRef.current, colorRef.current)
            return
        }

        const now = performance.now()
        if (newCount > prev) {
            for (let i = prev; i < newCount; i++) {
                const m = marks[i]
                m.active = true
                m.state = "in"
                m.vx = 0
                m.vy = 0
                m.x = m.restX + (Math.random() - 0.5) * 6
                m.y = -18 - Math.random() * 26
                m.spawnAt = now + (i - prev) * 55
            }
            // Top tier overfills: once the jar is full, extra marks keep dropping in
            // from the TOP, hit the brim, and (no room) deflect off to the sides and
            // tumble down the outside. They fall physically — no popping at centre.
            if (value === "high") {
                const fillDelay = (newCount - prev) * 55
                for (let k = 0; k < SPILL; k++) {
                    const side = k % 2 === 0 ? -1 : 1 // spawn a touch left / right of centre
                    const m = marks[MOUND + k]
                    m.active = true
                    m.state = "spill"
                    m.x = PILE.cx + side * (6 + Math.random() * 16)
                    m.y = -14 - Math.random() * 22 // start above the jar → real fall
                    m.vx = 0
                    m.vy = 0
                    m.vr = 0
                    m.spawnAt = now + fillDelay + 180 + k * 150
                }
            }
        } else {
            for (let i = prev - 1; i >= newCount; i--) {
                const m = marks[i]
                m.state = "out"
                m.vx = 0
                m.vy = 0.4
                m.vr = (Math.random() - 0.5) * 0.5
                m.spawnAt = now + (prev - 1 - i) * 55
            }
        }
        if (!rafRef.current) {
            const loop = (t: number) => {
                const moving = stepPile(marks, t)
                paintPile(ctx, marks, pathRef.current, colorRef.current)
                rafRef.current = moving ? requestAnimationFrame(loop) : 0
            }
            rafRef.current = requestAnimationFrame(loop)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    return <canvas ref={canvasRef} style={{ width: PILE.W, height: PILE.H }} aria-hidden />
}

// ── shared bits ──────────────────────────────────────────────────────────────

function SceneTitle({ children }: { children: React.ReactNode }) {
    return <h1 className="text-balance text-[21px] font-bold tracking-[-0.014em] text-[color:var(--c-text)]">{children}</h1>
}

function Dots({ step }: { step: number }) {
    return (
        <div className="mt-2 flex items-center gap-1.5">
            {STEPS.map((s, i) => (
                <motion.span
                    key={s}
                    animate={{
                        width: i === step ? 26 : 7,
                        backgroundColor: i <= step ? "var(--c-primary)" : "var(--c-border)",
                    }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className="h-[7px] rounded-full"
                />
            ))}
        </div>
    )
}

function AmbientGlow({ reduce, step }: { reduce: boolean; step: number }) {
    return (
        <motion.div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <motion.div
                className="absolute h-64 w-64 rounded-full bg-[color:var(--c-primary)] opacity-[0.07] blur-3xl"
                animate={reduce ? { top: "10%", left: step === 2 ? "55%" : "10%" } : { top: ["8%", "16%", "8%"], left: step === 2 ? "52%" : "8%" }}
                transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
                className="absolute bottom-0 right-0 h-56 w-56 rounded-full bg-[#3fb950] opacity-[0.05] blur-3xl"
                animate={reduce ? {} : { y: [0, -18, 0] }}
                transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
            />
        </motion.div>
    )
}

function DotPulse({ reduce }: { reduce: boolean }) {
    return (
        <motion.span
            className="h-2 w-2 rounded-full bg-emerald-500"
            animate={reduce ? {} : { scale: [1, 1.35, 1], opacity: [1, 0.6, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
    )
}

// ── icons ────────────────────────────────────────────────────────────────────

function GithubMark() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2A10 10 0 0 0 8.8 21.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7c-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .3.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" />
        </svg>
    )
}
function UcelotLogo() {
    return (
        <span className="text-[color:var(--c-primary)]">
            <BobbyMark size={25} />
        </span>
    )
}
function RefreshMark() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            <path d="M3 21v-5h5" />
        </svg>
    )
}
function PauseMark() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M9 6v12M15 6v12" />
        </svg>
    )
}
function TwoWayIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7 7h12l-3-3M17 17H5l3 3" />
        </svg>
    )
}
function ArrowRightIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
    )
}
function ArrowLeftIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
    )
}
function OffIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M6 6l12 12" />
        </svg>
    )
}
