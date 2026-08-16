"use client"

import { LazyMotion } from "framer-motion"

// Loads framer-motion's animation features asynchronously, so the full library
// isn't on the shell's hydration path. Every authed page mounts the sidebar,
// team selector and notification bell; importing `motion` in any of them pulls
// the whole library into the shell chunk, which the browser must parse before
// the app can hydrate — before the session is even read.
//
// The fix is framer's own split: components import `m` instead of `motion`
// (identical API, none of the bundled features), and the features load from
// their own chunk after first paint. The trade is that an animation firing in
// the first moments of a page's life won't animate — so anything animating on
// MOUNT belongs in CSS instead (see .anim-fade / .stagger in globals.css).
// Everything left on `m` here is interaction-driven — opening a dropdown,
// collapsing a section — which can't happen before the features land.
//
// Deliberately not `strict`: page-level components outside the shell still
// import `motion` directly and render inside this provider. They keep working
// as before (loading their own features into their route chunk); strict mode
// would throw on them.
const loadFeatures = () => import("@/components/ui/motion-features").then((mod) => mod.default)

export function MotionProvider({ children }: { children: React.ReactNode }) {
    return <LazyMotion features={loadFeatures}>{children}</LazyMotion>
}
