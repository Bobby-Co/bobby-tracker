"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/lib/auth/auth-context"
import { isAllowed } from "@/lib/auth/access"
import { BrandLockup } from "@/components/BrandLockup"
import PixelScatter from "@/components/pixel-scatter"

// Warm tones that read on the cream background (no white — it'd vanish).
const PARTICLE_COLORS = ["#facc15", "#f59e0b", "#ea580c", "#dc2626", "#b45309"]

// Deterministic pseudo-random in [0,1) from a seed — keeps the particle spread
// varied but stable across renders (Math.random would be impure during render).
const rand = (seed: number) => {
    const x = Math.sin(seed) * 43758.5453
    return x - Math.floor(x)
}

export default function WaitlistPage() {
    const router = useRouter()
    const { user, loading } = useAuth()
    const supabase = useMemo(() => createClient(), [])
    const [status, setStatus] = useState<"idle" | "joining" | "joined">("idle")
    const [error, setError] = useState<string | null>(null)

    // Gate: anonymous → sign in; already whitelisted → straight to the app.
    // Only non-whitelisted, signed-in users actually see this page.
    useEffect(() => {
        if (loading) return
        if (!user) {
            router.replace("/login?next=/waitlist")
            return
        }
        if (isAllowed(user)) router.replace("/projects")
    }, [loading, user, router])

    // Returning visitors who already raised their hand see the joined state;
    // a fresh click drives the burst animation (status === "joined").
    const alreadyRequested = !!user?.user_metadata?.beta_requested
    const joined = status === "joined" || alreadyRequested
    const showBurst = status === "joined"

    // Radial confetti — pixel squares (a nod to the motif) flung outward from
    // the button. Deterministic spread, generated once.
    const particles = useMemo(
        () =>
            Array.from({ length: 30 }, (_, i) => {
                const angle = (i / 30) * Math.PI * 2 + (rand(i * 1.7 + 0.3) - 0.5) * 0.5
                const dist = 90 + rand(i * 3.1 + 1.9) * 130
                return {
                    tx: Math.round(Math.cos(angle) * dist),
                    ty: Math.round(Math.sin(angle) * dist),
                    rot: Math.round((rand(i * 5.3 + 4.2) * 2 - 1) * 200),
                    delay: Math.round(rand(i * 7.7 + 2.6) * 70),
                    size: 4 + Math.round(rand(i * 9.1 + 0.5) * 5),
                    color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
                }
            }),
        [],
    )

    async function join() {
        if (joined || status === "joining") return
        setStatus("joining")
        setError(null)
        const { error } = await supabase.auth.updateUser({
            data: { beta_requested: true, beta_requested_at: new Date().toISOString() },
        })
        if (error) {
            setError(error.message)
            setStatus("idle")
            return
        }
        setStatus("joined")
    }

    // Resolving the session or mid-redirect (whitelisted users bounce to the
    // app) — hold a warm brand splash so nothing flashes.
    if (loading || !user || isAllowed(user)) {
        return (
            <main className="relative grid min-h-screen place-items-center overflow-hidden bg-white">
                <div className="opacity-60">
                    <BrandLockup />
                </div>
            </main>
        )
    }

    return (
        <main className="relative grid min-h-screen place-items-center overflow-hidden bg-white px-6">
            <style>{WAITLIST_CSS}</style>

            {/* Pixelated corner gradient — same cell size + palette as the
                landing, glowing from the corners and fading to white centre. */}
            <PixelScatter cell={48} fill={0.4} />
            <div className="anim-rise relative z-10 flex flex-col items-center justify-center rounded-[40px] text-center px-4 sm:px-16 sm:py-24 lg:rounded-full lg:px-32 lg:py-32">
                <div className="flex justify-center">
                    <BrandLockup tone={"dark"} />
                </div>


                <h1 className="mt-6 text-[34px] font-extrabold leading-[1.05] tracking-[-0.035em] text-red-950 sm:text-[48px] lg:text-[56px]">
                    Something great
                    <br />
                    is brewing.
                </h1>

                <p className="mt-5 max-w-md text-[15px] leading-7 text-amber-950">
                    Thank you for your interest in Ucelot. We&apos;re putting the final polish on the
                    product. See you very soon.
                </p>

                {/* CTA / success */}
                <div className="relative mt-9 flex flex-col items-center">
                    {/* burst layer, centred on the button */}
                    {showBurst && (
                        <div className="pointer-events-none absolute left-1/2 top-7 z-20 -translate-x-1/2">
                            <span className="wl-ring" />
                            {particles.map((p, i) => (
                                <span
                                    key={i}
                                    className="wl-particle"
                                    style={
                                        {
                                            width: p.size,
                                            height: p.size,
                                            background: p.color,
                                            ["--tx" as string]: `${p.tx}px`,
                                            ["--ty" as string]: `${p.ty}px`,
                                            ["--rot" as string]: `${p.rot}deg`,
                                            animationDelay: `${p.delay}ms`,
                                        } as React.CSSProperties
                                    }
                                />
                            ))}
                        </div>
                    )}

                    {!joined ? (
                        <button onClick={join} disabled={status === "joining"} className="wl-cta rounded-sq-3xl transition-transform">
                            {status === "joining" ? (
                                <span className="wl-spinner" aria-label="Joining" />
                            ) : (
                                <>
                                    <span>Join the beta</span>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path
                                            d="M5 12h14M13 6l6 6-6 6"
                                            stroke="currentColor"
                                            strokeWidth="2.2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                </>
                            )}
                        </button>
                    ) : (
                        <div className="wl-joined relative z-10 flex flex-col items-center">
                            <div className="wl-check-badge rounded-sq-3xl">
                                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
                                    <path
                                        className="wl-check"
                                        d="M5 13l4 4L19 7"
                                        stroke="currentColor"
                                        strokeWidth="2.6"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </div>
                            <p className="mt-4 text-[18px] font-bold tracking-[-0.01em] text-red-950">
                                You&apos;re on the list!
                            </p>
                        </div>
                    )}

                    {!joined && (
                        <p className="mt-4 text-[12.5px] text-amber-900/55">
                            Be first in line — we&apos;ll email you when your spot is ready.
                        </p>
                    )}

                    {error && (
                        <p className="mt-4 rounded-[10px] bg-rose-100 px-3 py-2 text-[12.5px] text-rose-800">
                            {error}
                        </p>
                    )}
                </div>
            </div>
        </main>
    )
}

const WAITLIST_CSS = `
.wl-cta {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 14px 28px;
    font-size: 15px; font-weight: 800; letter-spacing: -0.01em;
    color: #4a1d05;
    background:  #f59e0b;
    box-shadow: 0 14px 38px -10px rgba(234,88,12,0.5), inset 0 1px 0 rgba(255,255,255,0.45);
    transition: transform 180ms cubic-bezier(0.22,1,0.36,1), box-shadow 180ms ease, filter 180ms ease;
    cursor: pointer;
}
.wl-cta:hover { transform: translateY(-2px) scale(1.02); box-shadow: 0 20px 50px -10px rgba(234,88,12,0.62), inset 0 1px 0 rgba(255,255,255,0.55); filter: brightness(1.04); }
.wl-cta:active { transform: translateY(0) scale(0.97); }
.wl-cta:disabled { cursor: default; opacity: 0.9; }

.wl-spinner {
    width: 18px; height: 18px; border-radius: 9999px;
    border: 2.5px solid rgba(74,29,5,0.35); border-top-color: #4a1d05;
    animation: wl-spin 0.7s linear infinite;
}
@keyframes wl-spin { to { transform: rotate(360deg); } }

.wl-particle {
    position: absolute; left: 0; top: 0; display: block;
    border-radius: 1px;
    animation: wl-particle 900ms cubic-bezier(0.16,0.84,0.36,1) forwards;
}
@keyframes wl-particle {
    0% { transform: translate(-50%, -50%) scale(1) rotate(0deg); opacity: 1; }
    100% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(0.2) rotate(var(--rot)); opacity: 0; }
}

.wl-ring {
    position: absolute; left: 0; top: 0; width: 40px; height: 40px;
    margin: -20px 0 0 -20px; border-radius: 9999px;
    border: 2px solid rgba(234,88,12,0.65);
    animation: wl-ring 720ms cubic-bezier(0.16,0.84,0.36,1) forwards;
}
@keyframes wl-ring {
    0% { transform: scale(0.3); opacity: 0.9; }
    100% { transform: scale(4.2); opacity: 0; }
}

.wl-joined { animation: wl-pop 460ms cubic-bezier(0.34,1.56,0.64,1) backwards; }
@keyframes wl-pop { 0% { transform: scale(0.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }

.wl-check-badge {
    display: grid; place-items: center;
    width: 58px; height: 58px;
    color: white;
    background: #f59e0b;
    box-shadow: 0 12px 30px -8px rgba(234,88,12,0.55);
}
.wl-check {
    stroke-dasharray: 30; stroke-dashoffset: 30;
    animation: wl-draw 460ms 160ms cubic-bezier(0.65,0,0.35,1) forwards;
}
@keyframes wl-draw { to { stroke-dashoffset: 0; } }

@media (prefers-reduced-motion: reduce) {
    .wl-particle, .wl-ring { animation: none; opacity: 0; }
    .wl-joined { animation: none; }
    .wl-check { animation: none; stroke-dashoffset: 0; }
    .wl-cta { transition: none; }
}
`
